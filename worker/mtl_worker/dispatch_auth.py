"""Xác thực request `/drain` từ dispatcher (apps/api/src/jobs/dispatcher.ts): body JSON `{dispatch_id, ts}` ký
HMAC-SHA256 bằng MODAL_DRAIN_SECRET, header `x-mtl-signature: sha256=<hex>`. ts lệch > 5' → từ chối (chống phát
lại request cũ). Không phụ thuộc Modal để test được ở local."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid

MAX_SKEW_S = 300
MIN_SECRET_LEN = 32


class DrainAuthError(ValueError):
    pass


def sign(body: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def verify(body: bytes, signature: str | None, secret: str, now: float | None = None) -> str:
    """→ dispatch_id khi hợp lệ; ngược lại DrainAuthError (không tiết lộ lý do chi tiết ra ngoài)."""
    if len(secret) < MIN_SECRET_LEN:
        raise DrainAuthError("secret quá ngắn")
    if not signature or not hmac.compare_digest(sign(body, secret), signature):
        raise DrainAuthError("chữ ký sai")
    try:
        data = json.loads(body)
        dispatch_id = str(uuid.UUID(str(data["dispatch_id"])))
        ts = float(data["ts"])
    except (ValueError, KeyError, TypeError) as e:
        raise DrainAuthError("body sai") from e
    if abs((time.time() if now is None else now) - ts) > MAX_SKEW_S:
        raise DrainAuthError("request quá cũ")
    return dispatch_id
