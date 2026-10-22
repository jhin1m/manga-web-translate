"""Handler từng JobType (trừ ingest — xem ingest.py). Hình dạng inputs/result theo JSON Schema ở packages/shared."""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from mtl_pipeline.images import open_rgb
from mtl_pipeline.ocr import ocr_page
from mtl_pipeline.pipeline import restore_sfx
from mtl_pipeline.providers.base import ProviderError
from mtl_pipeline.schema import (
    BBox,
    ContextLine,
    OcrItem,
    PageText,
    Region,
    RegionText,
    RollingContext,
    TextBox,
)
from mtl_pipeline.textmask import estimate_polarity
from mtl_pipeline.translate import SeriesSettings, qualified_id, translate_chapter
from mtl_pipeline.typeset import bubble_siblings, font_for, typeset_region

from . import PIPELINE_VERSION
from .export import handle_export
from .ingest import handle_ingest
from .runner import (
    Deps,
    Handler,
    JobContext,
    JobFailure,
    classify_provider_error,
    nfc,
    open_gray,
    png_bytes,
    region_from_shared,
    region_to_shared,
)


def _ocr_item_to_shared(it: OcrItem) -> dict[str, Any]:
    return {
        "id": it.id,
        "source": nfc(it.source),
        "is_sfx": it.is_sfx,
        "empty": it.empty,
        "confidence": float(it.confidence),
        "low_conf": it.low_conf,
    }


# ---- page.prepare (giai đoạn 1) ----


def handle_prepare(ctx: JobContext, deps: Deps) -> dict[str, Any]:
    rev = ctx.outputs["clean"]["rev"]
    img = open_rgb(ctx.download(ctx.inputs["original"]))
    partial = ctx.inputs.get("partial")
    if partial:
        # Attempt trước đã detect + inpaint (lỗi ở bước LLM) → dùng lại, chỉ chạy OCR.
        ctx.report("reuse_partial", 0.1)
        regions = [region_from_shared(r) for r in partial["regions"]]
        clean = open_rgb(ctx.download(partial["clean"]))
        mask = open_gray(ctx.download(partial["mask"]))
    else:
        ctx.report("detect", 0.05)
        # Payload trước khi có reading_order/source_lang (job xếp hàng từ bản cũ) → mặc định manhwa tiếng Hàn.
        rtl = ctx.payload.get("reading_order", "ltr") == "rtl"
        regions, mask, clean, _ = deps.pipeline.prepare_image(img, rtl)
    ctx.report("ocr", 0.6)
    try:
        # LLM gọi cuối cùng: lỗi provider vẫn giữ được artifact detect/inpaint.
        ocr = ocr_page(deps.provider, img, regions, 0, ctx.payload.get("source_lang", "ko"))
    except ProviderError as e:
        failure = classify_provider_error(e)
        ctx.upload("clean", png_bytes(clean)[0])
        ctx.upload("mask", png_bytes(mask)[0])
        failure.partial = {
            "clean_rev": rev,
            "mask_rev": rev,
            "regions": [region_to_shared(r) for r in regions],
        }
        raise failure from e
    ctx.add_usage(ocr.usage)
    if any(r.is_sfx for r in regions):
        clean, mask = restore_sfx(img, clean, mask, regions)
    ctx.report("upload", 0.9)
    ctx.upload("clean", png_bytes(clean)[0])
    ctx.upload("mask", png_bytes(mask)[0])
    return {
        "type": "page.prepare",
        "clean_rev": rev,
        "mask_rev": rev,
        "ocr_result": {
            "regions": [region_to_shared(r) for r in regions],
            "items": [_ocr_item_to_shared(it) for it in ocr.items],
        },
    }


# ---- chapter.translate (giai đoạn 2) ----


def _settings(payload: dict[str, Any]) -> SeriesSettings:
    s = payload["settings"]
    rules = s["pronoun_rules"]
    if s["style_prompt"].strip():
        rules = f"{rules}\nPhong cách: {s['style_prompt'].strip()}".strip()
    return SeriesSettings(
        source_lang=s.get("source_lang", "ko"),
        target_lang=s.get("target_lang", "vi"),
        glossary=dict(s["glossary"]),
        pronoun_rules=rules,
        honorific_policy=s["honorific_policy"],
    )


def _flags(item: OcrItem | None, low_conf: bool) -> list[str]:
    flags: list[str] = []
    if item and item.is_sfx:
        flags.append("sfx")
    if item and item.empty:
        flags.append("empty")
    if low_conf or (item and item.low_conf):
        flags.append("low_conf")
    return flags


def _text_box_to_shared(b: TextBox) -> dict[str, Any]:
    return {
        "id": b.id,
        "region_id": b.region_id,
        "x": b.x,
        "y": b.y,
        "w": b.w,
        "h": b.h,
        "rotation": b.rotation,
        "text": nfc(b.text),
        "lines": [nfc(ln) for ln in b.lines],
        "font_family": b.font_family,
        "font_size": b.font_size,
        "line_height": b.line_height,
        "pad": b.pad,
        "letter_spacing": 0,
        "align": b.align,
        "fill": b.fill,
        "stroke": b.stroke.model_dump() if b.stroke and b.stroke.width > 0 else None,
        "auto_fit": True,
        "hidden": False,
    }


def build_page_state(
    w: int,
    h: int,
    regions: list[Region],
    items: dict[str, OcrItem],
    translations: dict[str, tuple[str, bool]],
    boxes: list[TextBox],
    meta: dict[str, Any],
) -> dict[str, Any]:
    """PageState dùng chung (packages/shared/src/page-state.ts) từ kết quả pipeline."""
    out_regions = []
    for r in regions:
        it = items.get(r.id)
        text, low = translations.get(r.id, ("", False))
        out_regions.append(
            {
                "id": r.id,
                "kind": r.kind,
                "bbox": [r.bbox.x, r.bbox.y, r.bbox.w, r.bbox.h],
                "polarity": r.polarity,
                "source_text": nfc(it.source) if it else "",
                "translation": nfc(text),
                "confidence": float(it.confidence) if it else 0.0,
                "flags": _flags(it, low),
            }
        )
    return {
        "schema_version": 1,
        "size": {"w": w, "h": h},
        "view": {"show_original": False},
        "regions": out_regions,
        "text_boxes": [_text_box_to_shared(b) for b in boxes],
        "meta": meta,
    }


def handle_translate(ctx: JobContext, deps: Deps) -> dict[str, Any]:
    p = ctx.payload
    pages_in = sorted(ctx.inputs["pages"], key=lambda pg: pg["ord"])
    parsed = []
    page_texts: list[PageText] = []
    for pg in pages_in:
        items = {it["id"]: OcrItem.model_validate(it) for it in pg["ocr_result"]["items"]}
        regions = [
            region_from_shared(r, items[r["id"]].is_sfx if r["id"] in items else False)
            for r in pg["ocr_result"]["regions"]
        ]
        by_id = {r.id: r for r in regions}
        texts = [
            RegionText(
                id=qualified_id(pg["ord"], it.id),
                kind=by_id[it.id].kind,
                bbox_norm=by_id[it.id].bbox.normalized(pg["width"], pg["height"]),
                source=it.source,
            )
            for it in items.values()
            if it.id in by_id and not it.empty and not it.is_sfx and it.source.strip()
        ]
        page_texts.append(PageText(ord=pg["ord"], regions=texts))
        parsed.append((pg, regions, items))

    lines = [ContextLine(**ln) for ln in ctx.inputs["context_lines"]]
    initial = RollingContext(lines=lines) if lines else None
    ctx.report("translate", 0.1)
    tr = translate_chapter(deps.provider, page_texts, _settings(p), "rolling", initial_context=initial)
    ctx.add_usage(tr.usage)
    font = p["settings"]["font"]
    # Job xếp hàng trước khi có narration_font → chữ ngoài bóng dùng font thoại như cũ.
    narration = p["settings"].get("narration_font") or font
    meta = {
        "pipeline_version": PIPELINE_VERSION,
        "model": deps.provider.model,
        "glossary_rev": p["glossary_rev"],
        "settings_rev": p["settings_rev"],
        "context_used": p["context"],
    }
    out = []
    for i, (pg, regions, items) in enumerate(parsed):
        ctx.report("typeset", 0.5 + 0.5 * i / max(1, len(parsed)))
        by_id = {r.id: r for r in regions}
        page_items = tr.items.get(str(pg["ord"]), {})
        translations: dict[str, tuple[str, bool]] = {}
        boxes: list[TextBox] = []
        clean = open_rgb(ctx.download(pg["clean"])) if page_items else None
        # Vùng chữ được đặt chữ: chỉ chúng chia nhau lòng bóng (vùng OCR rỗng không giữ chỗ).
        texted = [
            r
            for r in regions
            if (t := page_items.get(qualified_id(pg["ord"], r.id))) and t.translation.strip()
        ]
        for r in regions:
            it = page_items.get(qualified_id(pg["ord"], r.id))
            if it is None:
                continue
            translations[r.id] = (it.translation, it.low_conf)
            if clean is not None and it.translation.strip():
                bubble = by_id.get(r.bubble_id) if r.bubble_id else None
                f = font_for(r, font, narration)
                boxes.append(typeset_region(clean, r, bubble, it.translation, f, bubble_siblings(r, texted)))
        state = build_page_state(pg["width"], pg["height"], regions, items, translations, boxes, meta)
        out.append({"page_id": pg["page_id"], "ai_state": state})
    return {"type": "chapter.translate", "pages": out}


# ---- page.reinpaint ----


def handle_reinpaint(ctx: JobContext, deps: Deps) -> dict[str, Any]:
    clean = open_rgb(ctx.download(ctx.inputs["base_clean"]))
    user = open_gray(ctx.download(ctx.inputs["user_mask"]))
    h, w = clean.shape[:2]
    ox, oy = ctx.payload["offset"]["x"], ctx.payload["offset"]["y"]
    mask = np.zeros((h, w), np.uint8)
    # Mask người vẽ đặt tại offset trên page; phần ra ngoài page bị cắt.
    x0, y0 = max(0, ox), max(0, oy)
    x1, y1 = min(w, ox + user.shape[1]), min(h, oy + user.shape[0])
    if x1 > x0 and y1 > y0:
        mask[y0:y1, x0:x1] = user[y0 - oy : y1 - oy, x0 - ox : x1 - ox]
    mask = np.where(mask > 0, 255, 0).astype(np.uint8)
    ctx.report("inpaint", 0.3)
    out, _ = deps.pipeline.inpainter.inpaint(clean, mask) if mask.any() else (clean, None)
    ctx.upload("clean", png_bytes(out)[0])
    return {"type": "page.reinpaint", "clean_rev": ctx.outputs["clean"]["rev"]}


# ---- page.ocr_region ----


def handle_ocr_region(ctx: JobContext, deps: Deps) -> dict[str, Any]:
    img = open_rgb(ctx.download(ctx.inputs["original"]))
    h, w = img.shape[:2]
    bx, by, bw, bh = ctx.payload["bbox"]
    x0, y0 = max(0, int(bx)), max(0, int(by))
    x1, y1 = min(w, int(round(bx + bw))), min(h, int(round(by + bh)))
    if x1 <= x0 or y1 <= y0:
        raise JobFailure("invalid_input", "bbox nằm ngoài page")
    crop = cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_RGB2GRAY)
    region = Region(
        id="r-user",
        kind="text_free",
        bbox=BBox(x=x0, y=y0, w=x1 - x0, h=y1 - y0),
        score=1.0,
        polarity=estimate_polarity(crop),
    )
    ctx.report("ocr", 0.2)
    source_lang = ctx.payload.get("source_lang", "ko")
    ocr = ocr_page(deps.provider, img, [region], 0, source_lang)
    ctx.add_usage(ocr.usage)
    item = next((it for it in ocr.items if it.id == region.id), OcrItem(id=region.id, empty=True))
    translation, low = "", item.low_conf
    if not item.empty and item.source.strip():
        ctx.report("translate", 0.6)
        lines = [ContextLine(**ln) for ln in ctx.inputs["context_lines"]]
        page = PageText(
            ord=0,
            regions=[
                RegionText(
                    id=qualified_id(0, region.id),
                    kind=region.kind,
                    bbox_norm=region.bbox.normalized(w, h),
                    source=item.source,
                )
            ],
        )
        settings = SeriesSettings(source_lang=source_lang, target_lang=ctx.payload.get("target_lang", "vi"))
        tr = translate_chapter(deps.provider, [page], settings, "rolling", RollingContext(lines=lines))
        ctx.add_usage(tr.usage)
        it = tr.items.get("0", {}).get(qualified_id(0, region.id))
        if it:
            translation, low = it.translation, low or it.low_conf
    return {
        "type": "page.ocr_region",
        "region": {
            "id": region.id,
            "kind": region.kind,
            "bbox": [x0, y0, x1 - x0, y1 - y0],
            "polarity": region.polarity,
            "source_text": nfc(item.source),
            "translation": nfc(translation),
            "confidence": float(item.confidence),
            "flags": _flags(item, low),
        },
    }


HANDLERS: dict[str, Handler] = {
    "chapter.ingest": handle_ingest,
    "page.prepare": handle_prepare,
    "chapter.translate": handle_translate,
    "page.reinpaint": handle_reinpaint,
    "page.ocr_region": handle_ocr_region,
    "chapter.export": handle_export,
}
# Loại cần LLM: worker không có provider (--no-llm) thì không khai các loại này.
LLM_TYPES = {"page.prepare", "chapter.translate", "page.ocr_region"}
