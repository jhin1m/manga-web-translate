"""Ghép các bước thành 2 giai đoạn trên thư mục ảnh (CLI dùng; Phase 3 bọc thành job).

Artifact mỗi trang ở <out>/<stem>/: regions.json, mask.png, clean.png (ghi TRƯỚC khi gọi LLM để lỗi provider
không làm mất phần đã tính), ocr.json, rồi giai đoạn 2: state.json + final.png.
"""

from __future__ import annotations

import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .detect import Detector
from .fonts import DEFAULT_FONT
from .images import open_rgb, save_png
from .inpaint import CompositeInpainter, FloodFillInpainter, Inpainter, LamaInpainter
from .local_ocr import LocalOcrEngine
from .models import ensure_model, verify_all
from .ocr import ocr_page
from .options import PrepareOptions
from .providers.base import LLMProvider
from .render import render_page, require_raqm
from .schema import ContextMode, OcrResult, PageAiState, PageText, Region, RegionText
from .textcolor import assign_colors
from .textmask import CtdMasker, build_text_mask
from .translate import SeriesSettings, qualified_id, translate_chapter
from .typeset import bubble_siblings, font_for, typeset_region

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def natural_key(p: Path) -> list[int | str]:
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", p.name)]


def list_pages(src: Path) -> list[Path]:
    return sorted((p for p in src.iterdir() if p.suffix.lower() in IMAGE_EXTS), key=natural_key)


@dataclass
class PrepareTiming:
    detect: float
    mask: float
    inpaint: float
    ocr: float

    @property
    def stage1_no_llm(self) -> float:
        return self.detect + self.mask + self.inpaint


# Hệ số đưa output LaMa về 0..255 theo model (xem inpaint.py).
LAMA_OUTPUT_SCALE = {"big_lama": 1.0, "lama_manga": 255.0}


class Pipeline:
    def __init__(self, threads: int = 0):
        require_raqm()
        paths = verify_all()
        self.threads = threads
        self.detector = Detector(paths["rtdetr_v2_comic"], threads=threads)
        self.masker = CtdMasker(paths["comic_text_detector"], threads=threads)
        self._lamas: dict[str, LamaInpainter] = {
            "big_lama": LamaInpainter(paths["big_lama"], threads=threads)
        }
        self._ocr: dict[str, LocalOcrEngine] = {}
        self._lock = threading.Lock()
        self.inpainter = self.inpainter_for("big_lama")

    def _lama(self, name: str) -> LamaInpainter:
        """Session LaMa theo tên, nạp lười (model optional tải theo lock khi cần lần đầu)."""
        with self._lock:
            if name not in self._lamas:
                if name not in LAMA_OUTPUT_SCALE:
                    raise ValueError(f"inpainter không hỗ trợ: {name}")
                self._lamas[name] = LamaInpainter(
                    ensure_model(name), threads=self.threads, output_scale=LAMA_OUTPUT_SCALE[name]
                )
            return self._lamas[name]

    def local_ocr(self, engine: str, source_lang: str, vertical: bool = False) -> LocalOcrEngine:
        """Engine OCR local (nạp lười, model optional tải theo lock). PaddleOCR: rec tiếng Hàn riêng, còn lại rec
        PP-OCRv6 đa ngữ; nối dòng bằng dấu cách cho ko/en, liền cho ja/zh. vertical: trang đọc phải→trái (manga
        Nhật dạng trang) → khối chữ cao đọc theo cột dọc; còn lại (manhua, webtoon) luôn tách dòng ngang."""
        # PaddleOCR khác cách nối dòng / chiều chữ theo ngôn ngữ → 1 engine / (ngôn ngữ, chiều) (model nhỏ, ~30MB).
        key = engine if engine == "manga_ocr" else f"{engine}:{source_lang}:{int(vertical)}"
        with self._lock:
            if key not in self._ocr:
                if engine == "manga_ocr":
                    from .local_ocr.manga_ocr import MangaOcr

                    self._ocr[key] = MangaOcr(
                        ensure_model("manga_ocr_encoder"),
                        ensure_model("manga_ocr_decoder"),
                        ensure_model("manga_ocr_vocab"),
                        threads=self.threads,
                    )
                elif engine == "paddle_ocr":
                    from .local_ocr.paddle_ocr import PaddleOcr

                    rec = "paddle_rec_korean" if source_lang == "ko" else "paddle_rec"
                    self._ocr[key] = PaddleOcr(
                        ensure_model("paddle_det"),
                        ensure_model(rec),
                        threads=self.threads,
                        join=" " if source_lang in ("ko", "en") else "",
                        vertical=vertical and source_lang in ("ja", "zh"),
                    )
                else:
                    raise ValueError(f"OCR engine không hỗ trợ: {engine}")
            return self._ocr[key]

    def inpainter_for(self, name: str = "big_lama", size: int | None = None) -> Inpainter:
        """Flood-fill nền phẳng trước, phần còn lại cho LaMa `name` (cửa sổ gom tối đa `size`)."""
        lama = self._lama(name)
        return CompositeInpainter(FloodFillInpainter(), lama.sized(size) if size else lama)

    # ---- giai đoạn 1 ----

    def prepare_image(
        self, img: np.ndarray, rtl: bool = False, opts: PrepareOptions | None = None
    ) -> tuple[list[Region], np.ndarray, np.ndarray, PrepareTiming]:
        opts = opts or PrepareOptions()
        ctd = opts.detector == "comic_text_detector"
        t0 = time.perf_counter()
        # CTD chạy 1 lượt cho cả mask lẫn khối chữ; RT-DETR vẫn cho bóng thoại.
        pred, blocks = self.masker.predict_with_blocks(img, opts.detection_threshold if ctd else None)
        # CTD: ngưỡng áp cho khối chữ CTD; bóng RT-DETR giữ ngưỡng mặc định (ngưỡng thấp sinh bóng rác cả trang).
        regions = self.detector.detect(
            img, rtl, None if ctd else opts.detection_threshold, blocks if ctd else None
        )
        t1 = time.perf_counter()
        mask = build_text_mask(img, pred, regions, opts.mask_dilation)
        t2 = time.perf_counter()
        clean, _ = self.inpainter_for(opts.inpainter, opts.inpaint_size).inpaint(img, mask)
        assign_colors(regions, clean)
        t3 = time.perf_counter()
        return regions, mask, clean, PrepareTiming(t1 - t0, t2 - t1, t3 - t2, 0.0)

    def prepare_page(
        self, src: Path, out_dir: Path, page_ord: int, provider: LLMProvider | None
    ) -> PrepareTiming:
        out_dir.mkdir(parents=True, exist_ok=True)
        img = open_rgb(src)
        regions, mask, clean, timing = self.prepare_image(img)
        save_png(mask, out_dir / "mask.png")
        save_png(clean, out_dir / "clean.png")
        write_regions(out_dir, regions, img.shape[1], img.shape[0], page_ord, src.name)
        if provider is not None:
            t = time.perf_counter()
            # OCR đọc ảnh GỐC (chữ đã bị xoá trên clean).
            res = ocr_page(provider, img, regions, page_ord)
            timing.ocr = time.perf_counter() - t
            (out_dir / "ocr.json").write_text(res.model_dump_json(indent=2))
            # is_sfx do OCR gắn → trả SFX về nguyên trạng (không xoá/dịch SFX), ghi lại artifact.
            if any(r.is_sfx for r in regions):
                clean, mask = restore_sfx(img, clean, mask, regions)
                save_png(mask, out_dir / "mask.png")
                save_png(clean, out_dir / "clean.png")
            write_regions(out_dir, regions, img.shape[1], img.shape[0], page_ord, src.name)
        (out_dir / "timing.json").write_text(json.dumps(timing.__dict__))
        return timing

    def prepare_dir(
        self, src: Path, out: Path, provider: LLMProvider | None, workers: int = 2
    ) -> tuple[dict[str, PrepareTiming], dict[str, str]]:
        """Chạy giai đoạn 1 cả thư mục; lỗi từng trang không làm mất kết quả trang khác.
        → (timing theo trang, lỗi theo trang); lỗi cũng ghi <out>/<stem>/error.txt."""
        pages = list_pages(src)
        timings: dict[str, PrepareTiming] = {}
        failures: dict[str, str] = {}
        with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
            futs = {
                p.stem: ex.submit(self.prepare_page, p, out / p.stem, i, provider)
                for i, p in enumerate(pages)
            }
            for stem, f in futs.items():
                try:
                    timings[stem] = f.result()
                except Exception as e:  # ghi lại mọi lỗi trang (ảnh hỏng, provider lỗi…) rồi đi tiếp
                    failures[stem] = f"{type(e).__name__}: {e}"
                    (out / stem).mkdir(parents=True, exist_ok=True)
                    (out / stem / "error.txt").write_text(failures[stem])
        return timings, failures


def restore_sfx(
    img: np.ndarray, clean: np.ndarray, mask: np.ndarray, regions: list[Region], margin: int = 12
) -> tuple[np.ndarray, np.ndarray]:
    """Trả pixel gốc cho vùng SFX (box + margin phủ phần giãn mask và feather LaMa), trừ phần thuộc vùng chữ khác."""
    clean, mask = clean.copy(), mask.copy()
    h, w = mask.shape
    keep = np.zeros((h, w), bool)
    for r in regions:
        if r.kind != "bubble" and not r.is_sfx:
            b = r.bbox
            keep[max(0, b.y - margin) : b.y2 + margin, max(0, b.x - margin) : b.x2 + margin] = True
    for r in regions:
        if not r.is_sfx:
            continue
        b = r.bbox
        ys = slice(max(0, b.y - margin), min(h, b.y2 + margin))
        xs = slice(max(0, b.x - margin), min(w, b.x2 + margin))
        sel = ~keep[ys, xs]
        clean[ys, xs][sel] = img[ys, xs][sel]
        mask[ys, xs][sel] = 0
    return clean, mask


def write_regions(out_dir: Path, regions: list[Region], w: int, h: int, page_ord: int, source: str) -> None:
    payload = {
        "page_ord": page_ord,
        "width": w,
        "height": h,
        "source": source,
        "regions": [r.model_dump() for r in regions],
    }
    (out_dir / "regions.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2))


def load_page_dirs(out: Path) -> list[tuple[Path, dict, OcrResult]]:
    """Mọi thư mục trang (có regions.json) phải có ocr.json — thiếu thì dừng, không dịch chương khuyết trang."""
    dirs = sorted((p for p in out.iterdir() if (p / "regions.json").is_file()), key=natural_key)
    missing = [d.name for d in dirs if not (d / "ocr.json").is_file()]
    if missing:
        raise FileNotFoundError(f"thiếu ocr.json (chạy lại prepare có OCR): {', '.join(missing)}")
    pages = []
    for d in dirs:
        meta = json.loads((d / "regions.json").read_text())
        pages.append((d, meta, OcrResult.model_validate_json((d / "ocr.json").read_text())))
    return sorted(pages, key=lambda t: t[1]["page_ord"])


# ---- giai đoạn 2 ----


def translate_dir(
    out: Path,
    provider: LLMProvider,
    settings: SeriesSettings,
    mode: ContextMode = "rolling",
    font_id: str = DEFAULT_FONT,
    suffix: str = "",
    narration_font_id: str | None = None,
) -> list[PageAiState]:
    """Dịch cả chương theo thứ tự trang, typeset, render final{suffix}.png + state{suffix}.json.
    Chữ ngoài bóng dùng narration_font_id (None → font_id), như server."""
    require_raqm()
    narration_font_id = narration_font_id or font_id
    pages = load_page_dirs(out)
    page_texts: list[PageText] = []
    for _, meta, ocr in pages:
        regions_by_id = {r["id"]: Region.model_validate(r) for r in meta["regions"]}
        texts = [
            RegionText(
                id=qualified_id(meta["page_ord"], it.id),
                kind=regions_by_id[it.id].kind,
                bbox_norm=regions_by_id[it.id].bbox.normalized(meta["width"], meta["height"]),
                source=it.source,
            )
            for it in ocr.items
            if not it.empty and not it.is_sfx and it.source.strip()
        ]
        page_texts.append(PageText(ord=meta["page_ord"], regions=texts))

    result = translate_chapter(provider, page_texts, settings, mode)
    (out / f"translate_usage{suffix}.json").write_text(
        json.dumps([u.model_dump() for u in result.usage], indent=2)
    )

    states = []
    for d, meta, ocr in pages:
        regions = [Region.model_validate(r) for r in meta["regions"]]
        by_id = {r.id: r for r in regions}
        clean = open_rgb(d / "clean.png")
        page_items = result.items.get(str(meta["page_ord"]), {})
        translations, boxes = [], []
        # Vùng chữ được đặt chữ: chỉ chúng chia nhau lòng bóng (vùng OCR rỗng không giữ chỗ).
        texted = [
            r
            for r in regions
            if (t := page_items.get(qualified_id(meta["page_ord"], r.id))) and t.translation.strip()
        ]
        for r in regions:
            it = page_items.get(qualified_id(meta["page_ord"], r.id))
            if it is None or not it.translation.strip():
                continue
            translations.append(it.model_copy(update={"id": r.id}))
            bubble = by_id.get(r.bubble_id) if r.bubble_id else None
            f = font_for(r, font_id, narration_font_id)
            boxes.append(typeset_region(clean, r, bubble, it.translation, f, bubble_siblings(r, texted)))
        state = PageAiState(
            page_ord=meta["page_ord"],
            width=meta["width"],
            height=meta["height"],
            regions=regions,
            ocr=ocr.items,
            translations=translations,
            boxes=boxes,
            meta={"context_used": result.context_used, "provider": provider.name, "model": provider.model},
        )
        save_png(render_page(clean, boxes), d / f"final{suffix}.png")
        (d / f"state{suffix}.json").write_text(state.model_dump_json(indent=2))
        states.append(state)
    return states
