"""Client file của worker: link tương đối `/files/…` (disk driver) resolve theo API; URL S3 tuyệt đối giữ nguyên;
không gửi Bearer token kèm request file."""

from __future__ import annotations

import httpx

from mtl_worker.client import WorkerClient


def _client(seen: list[httpx.Request]) -> WorkerClient:
    c = WorkerClient("http://api.test/", "tok", "w1")

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, content=b"ok")

    # Giữ nguyên base_url/headers của client thật, chỉ thay transport.
    c.files._transport = httpx.MockTransport(handler)
    return c


def test_relative_file_url_resolves_against_api() -> None:
    seen: list[httpx.Request] = []
    c = _client(seen)
    assert c.download("/files/u/a/ch/b/src/c.png?exp=1&sig=ab") == b"ok"
    assert str(seen[0].url) == "http://api.test/files/u/a/ch/b/src/c.png?exp=1&sig=ab"
    assert "authorization" not in seen[0].headers


def test_absolute_url_kept_and_put_headers_sent() -> None:
    seen: list[httpx.Request] = []
    c = _client(seen)
    s3 = "http://files.example:9100/mtl/u/a/x.png?X-Amz-Signature=abc%2Fdef"
    c.download(s3)
    assert str(seen[0].url) == s3
    assert c.upload_png("/files/u/a/x.png?m=PUT&exp=1&ct=image%2Fpng&sig=ab", b"png")
    assert str(seen[1].url) == "http://api.test/files/u/a/x.png?m=PUT&exp=1&ct=image%2Fpng&sig=ab"
    assert seen[1].headers["content-type"] == "image/png"
    assert "authorization" not in seen[1].headers
