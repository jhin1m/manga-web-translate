"""Client HTTP cho /worker/v1 (chỉ gọi ra ngoài). 409 → LeaseLost (bỏ job, không retry); lỗi mạng/5xx → retry."""

from __future__ import annotations

import os
import time
from collections.abc import Iterator
from typing import Any, Protocol

import httpx

from mtl_pipeline.schema import validate_contract

from . import PIPELINE_VERSION


class LeaseLost(RuntimeError):
    """Lease không còn (hết hạn, job bị claim lại, huỷ...) — worker phải bỏ job ngay."""


class PipelineTooOld(RuntimeError):
    pass


class AuthError(RuntimeError):
    pass


RETRY_STATUSES = {502, 503, 504}
UPLOAD_CHUNK = 1 << 20


def _file_chunks(path: str) -> Iterator[bytes]:
    with open(path, "rb") as f:
        while chunk := f.read(UPLOAD_CHUNK):
            yield chunk


class WorkerApi(Protocol):
    """Phần client mà runner/handler dùng sau khi claim — WorkerClient là bản HTTP; test dùng bản giả."""

    def heartbeat(
        self, job: dict[str, Any], progress: float, stage: str | None, usage: dict | None
    ) -> dict[str, Any]: ...

    def presign_outputs(self, job: dict[str, Any], names: list[str]) -> dict[str, dict[str, Any]]: ...

    def complete(self, job: dict[str, Any], result: dict[str, Any], usage: dict | None) -> dict[str, Any]: ...

    def fail(
        self,
        job: dict[str, Any],
        error_class: str,
        message: str,
        retry_after_s: float | None = None,
        usage: dict | None = None,
        partial: dict | None = None,
    ) -> dict[str, Any]: ...

    def download(self, url: str) -> bytes: ...

    def upload_png(self, url: str, data: bytes) -> bool: ...

    def upload_file(self, url: str, path: str, headers: dict[str, str]) -> bool: ...


class WorkerClient:
    def __init__(self, api: str, token: str, worker_id: str, timeout: float = 30.0, retries: int = 4):
        self.worker_id = worker_id
        self.retries = retries
        self.http = httpx.Client(
            base_url=api.rstrip("/") + "/worker/v1",
            headers={"authorization": f"Bearer {token}"},
            timeout=timeout,
        )
        # Tải/đẩy file qua presigned URL: không gửi Bearer token sang domain file.
        self.files = httpx.Client(timeout=httpx.Timeout(300.0, connect=30.0), follow_redirects=False)

    def close(self) -> None:
        self.http.close()
        self.files.close()

    def _post(self, path: str, body: dict[str, Any], retry: bool = True) -> dict[str, Any]:
        """retry=False cho lệnh không idempotent (claim): gửi lại sau khi lần đầu đã tới server sẽ claim job thứ 2
        còn job đầu nằm im tới hết lease."""
        delay = 1.0
        retries = self.retries if retry else 0
        for attempt in range(retries + 1):
            try:
                r = self.http.post(path, json=body)
            except httpx.TransportError:
                if attempt == retries:
                    raise
                time.sleep(delay)
                delay *= 2
                continue
            if r.status_code in RETRY_STATUSES and attempt < retries:
                time.sleep(delay)
                delay *= 2
                continue
            if r.status_code == 409:
                raise LeaseLost(r.text)
            if r.status_code == 426:
                raise PipelineTooOld(r.text)
            if r.status_code == 401:
                raise AuthError("token worker không hợp lệ hoặc đã bị thu hồi")
            r.raise_for_status()
            return r.json()
        raise RuntimeError("unreachable")

    def claim(self, capabilities: list[str], max_jobs: int = 1) -> list[dict[str, Any]]:
        res = self._post(
            "/claim",
            {
                "worker_id": self.worker_id,
                "capabilities": capabilities,
                "max": max_jobs,
                "pipeline_version": PIPELINE_VERSION,
                "dispatch_id": None,
            },
            retry=False,
        )
        validate_contract("claim-response", res)
        return res["jobs"]

    @staticmethod
    def _fence(job: dict[str, Any]) -> dict[str, Any]:
        return {"lease_token": job["lease_token"], "attempt": job["attempt"]}

    def heartbeat(
        self, job: dict[str, Any], progress: float, stage: str | None, usage: dict | None
    ) -> dict[str, Any]:
        body = {**self._fence(job), "progress": progress, "stage": stage, "usage": usage}
        return self._post(f"/jobs/{job['id']}/heartbeat", body)

    def presign_outputs(self, job: dict[str, Any], names: list[str]) -> dict[str, dict[str, Any]]:
        res = self._post(f"/jobs/{job['id']}/presign-outputs", {**self._fence(job), "names": names})
        validate_contract("presign-outputs-response", res)
        return res["outputs"]

    def complete(self, job: dict[str, Any], result: dict[str, Any], usage: dict | None) -> dict[str, Any]:
        validate_contract("job-result", result)
        body = {**self._fence(job), "result": result, "usage": usage, "pipeline_version": PIPELINE_VERSION}
        return self._post(f"/jobs/{job['id']}/complete", body)

    def fail(
        self,
        job: dict[str, Any],
        error_class: str,
        message: str,
        retry_after_s: float | None = None,
        usage: dict | None = None,
        partial: dict | None = None,
    ) -> dict[str, Any]:
        body = {
            **self._fence(job),
            "error_class": error_class,
            "retry_after_s": retry_after_s,
            "message": message[:4000],
            "usage": usage,
            "partial": partial,
        }
        return self._post(f"/jobs/{job['id']}/fail", body)

    def download(self, url: str) -> bytes:
        r = self.files.get(url)
        r.raise_for_status()
        return r.content

    def upload_png(self, url: str, data: bytes) -> bool:
        """PUT presigned; False khi URL đã hết hạn (403) → caller xin URL mới qua presign_outputs."""
        r = self.files.put(url, content=data, headers={"content-type": "image/png"})
        if r.status_code == 403:
            return False
        r.raise_for_status()
        return True

    def upload_file(self, url: str, path: str, headers: dict[str, str]) -> bool:
        """PUT presigned streaming từ file (không đọc cả file vào RAM). `headers` nằm trong chữ ký URL nên gửi
        đúng nguyên văn; 403 → False (URL hết hạn)."""
        sent = {k: v for k, v in headers.items() if k.lower() not in ("content-length", "transfer-encoding")}
        sent["content-length"] = str(os.path.getsize(path))
        r = self.files.put(url, content=_file_chunks(path), headers=sent)
        if r.status_code == 403:
            return False
        r.raise_for_status()
        return True
