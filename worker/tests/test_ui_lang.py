"""Ngôn ngữ ghi chú AI cho người đọc (payload `ui_lang`): prompt giữ tiếng Việt, chỉ chỉ dẫn `style_note` (dịch) và
`reason` (hiệu đính) viết bằng ngôn ngữ giao diện; payload thiếu `ui_lang` (job xếp hàng trước) → tiếng Việt."""

from __future__ import annotations

import json
from typing import Any

import pytest

from mtl_pipeline.providers.base import load_prompt, proofread_user_text, translate_user_text
from mtl_pipeline.schema import (
    ContractError,
    ProofreadItem,
    ProofreadRequest,
    ProofreadResult,
    TranslateRequest,
    validate_contract,
)
from mtl_worker.handlers import HANDLERS, handle_translate
from mtl_worker.runner import JobContext, run_job
from tests.test_llm_contract import ScriptedProvider
from tests.test_proofread import REGIONS, SeqProvider, _ImgClient, _usage
from tests.test_proofread import _job as proofread_job
from tests.test_translate_carry import _Deps
from tests.test_translate_carry import _job as translate_job
from tests.test_translate_style_note import _run
from tests.test_worker_runner import PAGE, FakeClient

# ---------- prompt + nội dung gửi LLM ----------


def test_prompts_tie_reader_notes_to_ui_lang():
    translate = load_prompt("translate_batch")
    assert "`ui_lang`" in translate
    assert "viết bằng ngôn ngữ `ui_lang`" in translate
    proofread = load_prompt("proofread_page")
    assert "`reason` (lý do ngắn viết bằng ngôn ngữ `ui_lang`" in proofread
    # Không còn ép lý do hiệu đính viết tiếng Việt.
    assert "lý do ngắn bằng tiếng Việt" not in proofread


@pytest.mark.parametrize(("code", "label"), [("en", "en (tiếng Anh)"), ("vi", "vi (tiếng Việt)")])
def test_user_text_names_the_reader_language(code, label):
    tr = json.loads(translate_user_text(TranslateRequest(pages=[], ui_lang=code)))
    pr = json.loads(proofread_user_text(ProofreadRequest(page_ord=0, regions=REGIONS, ui_lang=code)))
    assert tr["ui_lang"] == label and pr["ui_lang"] == label


def test_requests_default_to_vietnamese():
    assert json.loads(translate_user_text(TranslateRequest(pages=[])))["ui_lang"] == "vi (tiếng Việt)"
    assert ProofreadRequest(page_ord=0, regions=REGIONS).ui_lang == "vi"


# ---------- hợp đồng payload ----------


@pytest.mark.parametrize("make", [lambda: translate_job(None), lambda: proofread_job([PAGE], [])])
def test_payload_schema_accepts_ui_lang_and_its_absence(make):
    job = make()
    validate_contract("job-payload", job["payload"])
    validate_contract("job-payload", {**job["payload"], "ui_lang": "en"})
    # Locale giao diện thêm sau (worker chưa biết tên) vẫn qua hợp đồng.
    validate_contract("job-payload", {**job["payload"], "ui_lang": "ja"})
    validate_contract("job-payload", {**job["payload"], "ui_lang": "zh-Hant"})
    for bad in ("", "EN", "english", "en_US"):
        with pytest.raises(ContractError):
            validate_contract("job-payload", {**job["payload"], "ui_lang": bad})


# ---------- handler ----------


def _translate(ui_lang: str | None) -> ScriptedProvider:
    job: dict[str, Any] = translate_job(None)
    if ui_lang is not None:
        job["payload"]["ui_lang"] = ui_lang
    prov = ScriptedProvider(tr=[_run("Calm, formal narrator")])
    result = handle_translate(JobContext(FakeClient(), job), _Deps(prov))
    validate_contract("job-result", result)
    return prov


def test_translate_handler_passes_ui_lang_to_the_request():
    prov = _translate("en")
    assert prov.tr_reqs[0].ui_lang == "en" and prov.tr_reqs[0].want_style is True


def test_translate_handler_without_ui_lang_still_runs_in_vietnamese():
    assert _translate(None).tr_reqs[0].ui_lang == "vi"


def _proofread(ui_lang: str | None) -> SeqProvider:
    prov = SeqProvider(
        [ProofreadResult(items=[ProofreadItem(id="t0", suggestion="Hello", reason="typo")], usage=_usage())]
    )

    class Deps:
        def provider_for(self, tier):
            return prov

    job = proofread_job([PAGE], [r.model_dump() for r in REGIONS])
    if ui_lang is not None:
        job["payload"]["ui_lang"] = ui_lang
    assert run_job(_ImgClient(), job, HANDLERS, Deps()) == "succeeded"
    return prov


def test_proofread_handler_passes_ui_lang_to_the_request():
    assert _proofread("en").reqs[0].ui_lang == "en"


def test_proofread_handler_without_ui_lang_still_runs_in_vietnamese():
    assert _proofread(None).reqs[0].ui_lang == "vi"


def test_unlisted_ui_lang_still_runs_and_reaches_the_prompt():
    # Locale giao diện mới hơn worker: job vẫn qua hợp đồng + chạy xong, mã đi thẳng vào nội dung gửi LLM.
    req = _proofread("ja").reqs[0]
    assert req.ui_lang == "ja"
    assert json.loads(proofread_user_text(req))["ui_lang"] == "ja (tiếng Nhật)"
    # Mã chưa có tên trong bảng tên ngôn ngữ thì giữ nguyên mã.
    assert json.loads(translate_user_text(TranslateRequest(pages=[], ui_lang="th")))["ui_lang"] == "th"
