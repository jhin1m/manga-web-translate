"""Giai đoạn 2 — dịch theo chương, tuần tự theo thứ tự trang, gộp lô K trang/call + ngữ cảnh cuộn."""

from __future__ import annotations

from dataclasses import dataclass, field

from .providers.base import LLMProvider, ProviderError
from .schema import (
    DEFAULT_HONORIFIC_POLICY,
    ContextLine,
    ContextMode,
    PageText,
    RollingContext,
    TokenUsage,
    TranslateItem,
    TranslateRequest,
)

MAX_PAGES_PER_BATCH = 4
MAX_REGIONS_PER_BATCH = 40
CONTEXT_LINES = 12
MAX_CHARACTERS = 30


@dataclass
class SeriesSettings:
    source_lang: str = "ko"
    target_lang: str = "vi"
    glossary: dict[str, str] = field(default_factory=dict)
    pronoun_rules: str = ""
    honorific_policy: str = DEFAULT_HONORIFIC_POLICY


@dataclass
class ChapterTranslation:
    items: dict[str, dict[str, TranslateItem]]  # page_ord(str) → region_id → item
    usage: list[TokenUsage]
    context_used: ContextMode
    # ord trang AI trả hỏng cả khi dịch riêng (items rỗng + low_conf).
    failed: list[int] = field(default_factory=list)
    # Ngữ cảnh sau lô cuối (notes + tên nhân vật) — job dịch lô kế của chương nối tiếp từ đây.
    context: RollingContext = field(default_factory=RollingContext)


def qualified_id(page_ord: int, region_id: str) -> str:
    return f"p{page_ord}.{region_id}"


def make_batches(
    pages: list[PageText], max_pages: int = MAX_PAGES_PER_BATCH, max_regions: int = MAX_REGIONS_PER_BATCH
) -> list[list[PageText]]:
    """Lô trang liên tiếp: dừng khi đủ max_pages hoặc thêm trang sẽ vượt max_regions (cái nào tới trước).
    Trang đơn lẻ có > max_regions vẫn đi riêng một lô."""
    batches: list[list[PageText]] = []
    cur: list[PageText] = []
    n = 0
    for p in sorted(pages, key=lambda p: p.ord):
        if not p.regions:
            continue
        if cur and (len(cur) >= max_pages or n + len(p.regions) > max_regions):
            batches.append(cur)
            cur, n = [], 0
        cur.append(p)
        n += len(p.regions)
    if cur:
        batches.append(cur)
    return batches


def update_context(
    ctx: RollingContext, batch: list[PageText], items: dict[str, TranslateItem], notes: str
) -> RollingContext:
    lines = list(ctx.lines)
    for p in batch:
        for r in p.regions:
            it = items.get(r.id)
            if it and it.translation:
                lines.append(ContextLine(source=r.source, translation=it.translation))
    speakers = [it.speaker for it in items.values() if it.speaker and it.speaker != "?"]
    # Giữ tên gặp gần nhất, giới hạn để prompt không phình theo chiều dài chương.
    characters = list(dict.fromkeys(ctx.characters + speakers))[-MAX_CHARACTERS:]
    return RollingContext(lines=lines[-CONTEXT_LINES:], characters=characters, notes=notes or ctx.notes)


def _translate_once(
    provider: LLMProvider, batch: list[PageText], settings: SeriesSettings, ctx: RollingContext | None
) -> tuple[dict[str, TranslateItem], str, list[TokenUsage]]:
    """1 call + retry 1 lần khi lệch id/JSON sai; vẫn lệch → id thiếu thành low_conf."""
    req = TranslateRequest(
        pages=batch,
        source_lang=settings.source_lang,
        target_lang=settings.target_lang,
        glossary=settings.glossary,
        pronoun_rules=settings.pronoun_rules,
        honorific_policy=settings.honorific_policy,
        context=ctx,
    )
    expected = [r.id for p in batch for r in p.regions]
    usage: list[TokenUsage] = []
    got: dict[str, TranslateItem] = {}
    have_result = False
    notes = ""
    for attempt in range(2):
        try:
            res = provider.translate_batch(req)
        except ProviderError as e:
            usage.extend(e.usage)
            if e.error_class == "schema" and attempt == 0 and e.retry_in_job:
                continue
            if e.error_class == "schema" and have_result:
                break  # lần 2 hỏng JSON → dùng kết quả lệch id của lần 1
            e.usage = usage
            raise
        have_result = True
        usage.extend(res.usage)
        got = {}
        for it in res.items:
            if it.id in expected and it.id not in got:
                got[it.id] = it
        notes = res.context_notes
        if len(got) == len(expected) and len(res.items) == len(expected):
            return got, notes, usage
    out = {
        i: got[i].model_copy(update={"low_conf": True}) if i in got else TranslateItem(id=i, low_conf=True)
        for i in expected
    }
    return out, notes, usage


def translate_chapter(
    provider: LLMProvider,
    pages: list[PageText],
    settings: SeriesSettings,
    mode: ContextMode = "rolling",
    initial_context: RollingContext | None = None,
) -> ChapterTranslation:
    """mode=rolling: lô K trang + ngữ cảnh cuộn; mode=none: từng trang riêng, không ngữ cảnh (nhánh đối chứng).
    initial_context: ngữ cảnh mở đầu (dịch lại 1 trang: nguồn + bản dịch trang n−1, nguồn trang n+1).

    id vùng phải duy nhất trong cả chương (region id chỉ duy nhất trong trang → dùng `qualified_id`)."""
    ids = [r.id for p in pages for r in p.regions]
    if len(ids) != len(set(ids)):
        raise ValueError("id vùng trùng giữa các trang; dùng qualified_id(ord, region_id)")
    batches = (
        make_batches(pages)
        if mode == "rolling"
        else [[p] for p in sorted(pages, key=lambda p: p.ord) if p.regions]
    )
    ctx = initial_context.model_copy(deep=True) if initial_context else RollingContext()
    out: dict[str, dict[str, TranslateItem]] = {}
    usage: list[TokenUsage] = []
    failed: list[int] = []
    while batches:
        batch = batches.pop(0)
        try:
            items, notes, u = _translate_once(provider, batch, settings, ctx if mode == "rolling" else None)
        except ProviderError as e:
            if e.error_class != "schema":
                e.usage = usage + e.usage  # giữ token của các lô đã xong
                raise  # 429 / provider / auth: để hàng đợi backoff hoặc fail
            # JSON sai hoặc vượt guard token: lỗi của riêng lô này, không fail cả chương (job chạy lại = trả tiền
            # dịch lại mọi lô đã xong, mà lô hỏng thường hỏng tiếp).
            usage.extend(e.usage)
            if len(batch) > 1:
                batches[:0] = [[p] for p in batch]  # tách từng trang: đầu ra mỗi call nhỏ hơn
                continue
            # 1 trang vẫn hỏng → ghi vào `failed` (handler bỏ trang khỏi kết quả → page lỗi riêng, bản AI cũ giữ
            # nguyên); items rỗng + low_conf để ngữ cảnh cuộn đi tiếp.
            failed.append(batch[0].ord)
            items, notes, u = {r.id: TranslateItem(id=r.id, low_conf=True) for r in batch[0].regions}, "", []
        usage.extend(u)
        for p in batch:
            out[str(p.ord)] = {r.id: items[r.id] for r in p.regions}
        if mode == "rolling":
            ctx = update_context(ctx, batch, items, notes)
    return ChapterTranslation(items=out, usage=usage, context_used=mode, failed=failed, context=ctx)
