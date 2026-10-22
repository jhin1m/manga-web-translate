"""Tên ngôn ngữ (mã ISO 639-1 → tên tiếng Việt) để ghi rõ cặp nguồn/đích trong nội dung gửi LLM."""

LANG_NAMES = {
    "ko": "tiếng Hàn",
    "ja": "tiếng Nhật",
    "zh": "tiếng Trung",
    "en": "tiếng Anh",
    "vi": "tiếng Việt",
    "id": "tiếng Indonesia",
    "es": "tiếng Tây Ban Nha",
    "pt": "tiếng Bồ Đào Nha",
    "fr": "tiếng Pháp",
}


def lang_label(code: str) -> str:
    """VD "ja (tiếng Nhật)"; mã lạ giữ nguyên mã."""
    name = LANG_NAMES.get(code)
    return f"{code} ({name})" if name else code
