"""Cache provider LLM theo cấu hình cấp job: job liên tiếp cùng provider/model/key dùng lại client (kết nối HTTP),
đổi key ở UI → khoá cache khác → client mới. Chỉ 1 luồng (vòng claim) dùng module này."""

from __future__ import annotations

import hashlib
import logging
from collections import OrderedDict
from typing import Any

from mtl_pipeline.providers import provider_from_config

log = logging.getLogger("mtl_worker")

MAX_CACHED = 8
_cache: OrderedDict[tuple[Any, ...], Any] = OrderedDict()


def _cache_key(cfg: dict[str, Any]) -> tuple[Any, ...]:
    digest = hashlib.sha256(cfg["api_key"].encode()).hexdigest()[:16]
    return (
        cfg["type"],
        cfg["model"],
        cfg.get("base_url"),
        cfg.get("structured_output"),
        bool(cfg.get("reasoning")),
        digest,
    )


def provider_for_config(cfg: dict[str, Any]) -> Any:
    key = _cache_key(cfg)
    hit = _cache.get(key)
    if hit is not None:
        _cache.move_to_end(key)
        return hit
    provider = provider_from_config(cfg)
    _cache[key] = provider
    while len(_cache) > MAX_CACHED:
        _, old = _cache.popitem(last=False)
        _close(old)
    return provider


def clear_cache() -> None:
    while _cache:
        _close(_cache.popitem()[1])


def _close(provider: Any) -> None:
    close = getattr(getattr(provider, "client", None), "close", None)
    if callable(close):
        try:
            close()
        except Exception as e:  # đóng client không được làm hỏng job đang chạy
            log.debug("đóng client provider lỗi: %s", type(e).__name__)
