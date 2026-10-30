"""Handler chapter.ingest: tải slice gốc → mtl_pipeline.ingest (strip ảo + cắt theo detector) → PUT từng page."""

from __future__ import annotations

from typing import Any

from mtl_pipeline.images import open_rgb
from mtl_pipeline.ingest import SourceSlice, build_pages

from .runner import Deps, JobContext, png_bytes


def handle_ingest(ctx: JobContext, deps: Deps) -> dict[str, Any]:
    sources = ctx.inputs["sources"]
    n_src = len(sources)
    slices: list[SourceSlice] = []
    # done = số ảnh đã tải xong (web đánh dấu từng ảnh gốc "Đã tải" / "Đang tải" / "Chờ").
    for i, s in enumerate(sources):
        ctx.report("download", 0.3 * i / max(1, n_src), done=i, total=n_src)
        slices.append(SourceSlice(s["source_file_id"], open_rgb(ctx.download(s["url"]))))
    ctx.report("download", 0.3, done=n_src, total=n_src)

    def on_group(i: int, n: int) -> None:
        ctx.report("cut", 0.3 + 0.4 * i / max(1, n), done=i, total=n)

    pages = build_pages(slices, ctx.payload["mode"], deps.pipeline.detector.detect, on_group)
    del slices
    ctx.outputs.update(ctx.client.presign_outputs(ctx.job, [f"page:{i}" for i in range(len(pages))]))
    out = []
    for ord_, page in enumerate(pages):
        ctx.report("upload", 0.7 + 0.3 * ord_ / max(1, len(pages)), done=ord_, total=len(pages))
        data, sha = png_bytes(page.image)
        ctx.upload(f"page:{ord_}", data)
        h, w = page.image.shape[:2]
        out.append(
            {
                "ord": ord_,
                "width": int(w),
                "height": int(h),
                "original_sha256": sha,
                "source_map": page.source_map,
                "cut_flag": page.cut_flag,
            }
        )
    return {"type": "chapter.ingest", "pages": out}
