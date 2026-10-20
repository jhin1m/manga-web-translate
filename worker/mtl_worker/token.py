"""Đọc token worker: env MTL_TOKEN (Modal secret), file (MTL_TOKEN_FILE, quyền 600, của chính user) hoặc macOS
Keychain. Không bao giờ qua argv."""

from __future__ import annotations

import os
import stat
import subprocess
import sys
from pathlib import Path

KEYCHAIN_SERVICE = "mtl-worker"


class TokenError(RuntimeError):
    pass


def read_token_file(path: Path) -> str:
    st = path.stat()
    if st.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise TokenError(f"{path}: quyền {oct(st.st_mode & 0o777)} quá rộng — chạy chmod 600 {path}")
    if hasattr(os, "getuid") and st.st_uid != os.getuid():
        raise TokenError(f"{path}: không thuộc user hiện tại")
    token = path.read_text().strip()
    if not token:
        raise TokenError(f"{path}: rỗng")
    return token


def read_keychain(account: str) -> str:
    """`security add-generic-password -s mtl-worker -a <account> -w` để lưu; ở đây chỉ đọc."""
    r = subprocess.run(
        ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode != 0 or not r.stdout.strip():
        raise TokenError(f"không thấy token trong Keychain (service={KEYCHAIN_SERVICE}, account={account})")
    return r.stdout.strip()


def load_token() -> str:
    # Container Modal: token nền tảng do Modal secret bơm vào env (không có file/Keychain, không qua argv).
    env_token = os.environ.get("MTL_TOKEN", "").strip()
    if env_token:
        return env_token
    path = os.environ.get("MTL_TOKEN_FILE")
    if path:
        return read_token_file(Path(path).expanduser())
    if sys.platform == "darwin":
        return read_keychain(os.environ.get("MTL_KEYCHAIN_ACCOUNT", "default"))
    raise TokenError("đặt MTL_TOKEN_FILE=<file token quyền 600> (hoặc dùng Keychain trên macOS)")
