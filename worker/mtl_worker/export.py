"""Handler chapter.export: vẽ chữ lên nền từng page → ZIP/CBZ (file tạm trên đĩa) → PUT presigned streaming.

Layout `pages`: 1 file/page. Layout `original_slices`: ghép lại đúng các slice upload gốc theo source_map bằng cửa sổ
trượt (SliceAssembler) — không giữ cả strip trong RAM. Ảnh đã nén nên entry zip dùng ZIP_STORED."""

from __future__ import annotations

import io
import os
import tempfile
import zipfile
from collections.abc import Iterable
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

import numpy as np
from PIL import Image

from mtl_pipeline.images import encode_png, open_rgb
from mtl_pipeline.render import SliceAssembler, SliceMapError, render_page_state

from .runner import Deps, JobContext, JobFailure

# Tiến độ: tải nền 0 → DOWNLOAD_SHARE, render → RENDER_SHARE, còn lại upload.
RENDER_SHARE = 0.9
DOWNLOAD_SHARE = 0.2
DEFAULT_PUT_HEADERS = {"content-type": "image/png"}


def encode_image(arr: np.ndarray, use_jpeg: bool, quality: int) -> bytes:
    if not use_jpeg:
        return encode_png(arr)
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def comic_info_xml(chapter: dict[str, Any], page_count: int) -> str:
    """ComicInfo.xml tối thiểu (đầu CBZ) cho trình đọc truyện."""
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<ComicInfo>\n"
        f"  <Series>{escape(chapter['series_title'])}</Series>\n"
        f"  <Number>{escape(chapter['number'])}</Number>\n"
        f"  <Title>{escape(chapter['title'])}</Title>\n"
        f"  <PageCount>{page_count}</PageCount>\n"
        "  <LanguageISO>vi</LanguageISO>\n"
        "</ComicInfo>\n"
    )


def _unique_ords(items: Iterable[dict[str, Any]], what: str) -> None:
    ords = [it["ord"] for it in items]
    if len(set(ords)) != len(ords):
        raise JobFailure("invalid_input", f"{what} trùng ord")


def _render(pg: dict[str, Any], background: str) -> np.ndarray:
    base = open_rgb(Path(background).read_bytes())
    if base.shape[1] != pg["width"] or base.shape[0] != pg["height"]:
        raise JobFailure(
            "invalid_input",
            f"nền page {pg['ord']} {base.shape[1]}x{base.shape[0]} lệch kích thước khai báo "
            f"{pg['width']}x{pg['height']}",
        )
    # Page chưa dịch: ảnh nền nguyên (không vẽ chữ dù state có box).
    return render_page_state(base, pg["state"]) if pg["translated"] else base


def _upload_export(ctx: JobContext, path: str, claimed_key: str) -> None:
    """Export chạy lâu hơn TTL của PUT → xin URL mới ngay trước khi upload; 403 → xin lại 1 lần."""
    for _ in range(2):
        out = ctx.client.presign_outputs(ctx.job, ["export"])["export"]
        ctx.outputs["export"] = out
        if out["key"] != claimed_key:
            raise JobFailure("internal", "presign export trả key khác key đã cấp lúc claim")
        ctx.check()
        if ctx.client.upload_file(out["put"], path, out.get("headers") or DEFAULT_PUT_HEADERS):
            return
    raise JobFailure("internal", "upload export: presigned URL bị từ chối")


def handle_export(ctx: JobContext, deps: Deps) -> dict[str, Any]:
    p, inp = ctx.payload, ctx.inputs
    cbz = p["format"] == "cbz"
    use_jpeg = cbz and p["quality"] < 100
    ext = "jpg" if use_jpeg else "png"
    include = bool(p["include_untranslated"])
    claimed = ctx.outputs.get("export")
    if claimed is None:
        raise JobFailure("internal", "claim không cấp output export")

    pages = sorted(inp["pages"], key=lambda pg: pg["ord"])
    _unique_ords(pages, "page")
    slices_mode = p["layout"] == "original_slices"
    # Page ẩn không xuất; layout `pages` đặt tên liên tục theo thứ tự page còn hiện (page chưa dịch bị bỏ vẫn giữ chỗ).
    shown = [pg for pg in pages if not pg.get("skipped")]
    rank = {pg["ord"]: i for i, pg in enumerate(shown)}
    assembler: SliceAssembler | None = None
    if slices_mode:
        _unique_ords(inp["sources"], "source")
        source_ord = {s["source_file_id"]: s["ord"] for s in inp["sources"]}
        try:
            assembler = SliceAssembler(pages, include)
        except SliceMapError as e:
            raise JobFailure("invalid_input", str(e)) from e
        unknown = [s for s in assembler.kept if s not in source_ord]
        if unknown:
            raise JobFailure("invalid_input", f"source_map trỏ slice không có trong sources: {unknown[0]}")
        work = [pg for pg in pages if assembler.needs_page(pg)]
        n_files = len(assembler.kept)
        max_ord = max((source_ord[s] for s in assembler.kept), default=0)
    else:
        work = [pg for pg in shown if include or pg["translated"]]
        n_files = len(work)
        max_ord = max((rank[pg["ord"]] for pg in work), default=0)
    # Tên file đủ chữ số để reader sắp đúng thứ tự (≥ 3, chương 1000+ ảnh → 4).
    digits = max(3, len(str(max_ord + 1)))
    if n_files == 0:
        raise JobFailure("invalid_input", "không có ảnh nào để xuất (tất cả page chưa dịch?)")

    with tempfile.TemporaryDirectory(prefix="mtl-export-") as tmp:
        # URL nền ký trần 15' (không xin lại được) → tải hết ra đĩa trước khi render (render chương dài có thể lâu hơn).
        backgrounds: dict[int, str] = {}
        for i, pg in enumerate(work):
            ctx.report("download", DOWNLOAD_SHARE * i / len(work), done=i, total=len(work))
            backgrounds[pg["ord"]] = os.path.join(tmp, f"bg-{pg['ord']}")
            Path(backgrounds[pg["ord"]]).write_bytes(ctx.download(pg["background"]))
        path = os.path.join(tmp, "export.zip")
        written = 0
        with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as zf:
            if cbz:
                zf.writestr("ComicInfo.xml", comic_info_xml(inp["chapter"], n_files))

            def emit(ord_: int, arr: np.ndarray) -> None:
                nonlocal written
                zf.writestr(f"{ord_ + 1:0{digits}d}.{ext}", encode_image(arr, use_jpeg, p["quality"]))
                written += 1

            for i, pg in enumerate(work):
                ctx.report(
                    "render",
                    DOWNLOAD_SHARE + (RENDER_SHARE - DOWNLOAD_SHARE) * i / len(work),
                    done=i,
                    total=len(work),
                )
                img = _render(pg, backgrounds[pg["ord"]])
                if assembler is None:
                    emit(rank[pg["ord"]], img)
                    continue
                try:
                    for sid, arr in assembler.add_page(pg, img):
                        emit(source_ord[sid], arr)
                except SliceMapError as e:
                    raise JobFailure("invalid_input", str(e)) from e
        if written != n_files:
            raise JobFailure("invalid_input", f"source_map thiếu đoạn: xuất {written}/{n_files} slice")
        size = os.path.getsize(path)
        ctx.report("upload", RENDER_SHARE)
        _upload_export(ctx, path, claimed["key"])
    return {"type": "chapter.export", "key": claimed["key"], "bytes": size}
