"""Cấu hình provider cấp job (claim `llm`): dựng đúng class, cache theo key, handler chọn đúng provider theo slot,
key không lọt vào log / fail.message, thiếu cấu hình → auth."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import pytest

from mtl_pipeline.providers import ProviderError, provider_from_config
from mtl_pipeline.providers.anthropic import AnthropicProvider
from mtl_pipeline.providers.gemini import GeminiProvider
from mtl_pipeline.providers.openai import OpenAIProvider
from mtl_pipeline.schema import ProofreadItem, ProofreadResult, validate_contract
from mtl_worker import LLM_NOT_CONFIGURED, llm_cache, log_redact
from mtl_worker.handlers import HANDLERS
from mtl_worker.main import RuntimeDeps
from mtl_worker.runner import run_job

from .test_llm_contract import ScriptedProvider
from .test_proofread import PAGE, REGIONS, SeqProvider, _ImgClient, _usage
from .test_proofread import _job as proofread_job
from .test_translate_carry import _Deps, _tr
from .test_translate_carry import _job as translate_job

KEY = "sk-test-0123456789abcdefXYZ"


def cfg(kind: str = "openai", model: str = "gpt-4.1-mini", key: str = KEY, **kw: Any) -> dict[str, Any]:
    return {
        "type": kind,
        "model": model,
        "api_key": key,
        "base_url": kw.pop("base_url", None),
        "structured_output": "json_schema",
        "reasoning": False,
        **kw,
    }


@pytest.fixture(autouse=True)
def _isolate():
    llm_cache.clear_cache()
    yield
    llm_cache.clear_cache()
    log_redact.clear_secrets()


class _Closable:
    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


class _Fake:
    model = "fake"

    def __init__(self, c: dict[str, Any]) -> None:
        self.cfg = c
        self.model = c["model"]
        self.client = _Closable()


@pytest.fixture
def fake_factory(monkeypatch):
    made: list[_Fake] = []

    def make(c: dict[str, Any]) -> _Fake:
        made.append(_Fake(c))
        return made[-1]

    monkeypatch.setattr(llm_cache, "provider_from_config", make)
    return made


# ---------- provider_from_config ----------


def test_builds_each_provider_type_with_explicit_key(monkeypatch):
    for v in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(v, raising=False)
    a = provider_from_config(cfg("anthropic", "claude-haiku-5-5"))
    assert isinstance(a, AnthropicProvider) and a.client.api_key == KEY and a.model == "claude-haiku-5-5"
    g = provider_from_config(cfg("gemini", "gemini-2.5-flash"))
    assert isinstance(g, GeminiProvider) and g.model == "gemini-2.5-flash"
    o = provider_from_config(cfg("openai"))
    assert isinstance(o, OpenAIProvider) and o.official and o.client.api_key == KEY
    c = provider_from_config(
        cfg(
            "openai_compatible", "m", base_url="https://openrouter.ai/api/v1", structured_output="json_object"
        )
    )
    assert isinstance(c, OpenAIProvider) and not c.official
    assert c.structured_output == "json_object" and "openrouter.ai" in str(c.client.base_url)


def test_unknown_type_rejected():
    with pytest.raises(ValueError):
        provider_from_config(cfg("mystery"))


# ---------- cache ----------


def test_same_config_reuses_instance_and_new_key_builds_new_one(fake_factory):
    p1 = llm_cache.provider_for_config(cfg())
    assert llm_cache.provider_for_config(cfg()) is p1
    p2 = llm_cache.provider_for_config(cfg(key="sk-test-another-key-0123456789"))
    assert p2 is not p1 and len(fake_factory) == 2
    assert llm_cache.provider_for_config(cfg(model="gpt-4.1")) is not p1


def test_eviction_closes_oldest_client(fake_factory):
    first = llm_cache.provider_for_config(cfg(model="m0"))
    for i in range(1, llm_cache.MAX_CACHED + 1):
        llm_cache.provider_for_config(cfg(model=f"m{i}"))
    assert first.client.closed
    assert not fake_factory[-1].client.closed


# ---------- handler chọn provider ----------


def test_translate_uses_slot_provider_not_env(fake_factory, monkeypatch):
    slot = ScriptedProvider(tr=[_tr("n")])
    slot.model = "gpt-4.1-mini"
    monkeypatch.setattr(llm_cache, "provider_from_config", lambda c: slot)
    env = ScriptedProvider(tr=[])  # chạm vào → IndexError
    job = translate_job(None)
    job["llm"] = {"translate": cfg()}
    job["payload"]["llm"] = {
        "translate": {"provider_id": "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a70", "model": "gpt-4.1-mini"}
    }
    validate_contract("job-payload", job["payload"])
    from mtl_worker.handlers import handle_translate
    from mtl_worker.runner import JobContext

    from .test_worker_runner import FakeClient

    result = handle_translate(JobContext(FakeClient(), job), _Deps(env))
    assert len(slot.tr_reqs) == 1 and not env.tr_reqs
    assert result["pages"][0]["ai_state"]["meta"]["model"] == "gpt-4.1-mini"


def test_translate_without_llm_uses_deps_provider():
    env = ScriptedProvider(tr=[_tr("n")])
    from mtl_worker.handlers import handle_translate
    from mtl_worker.runner import JobContext

    from .test_worker_runner import FakeClient

    result = handle_translate(JobContext(FakeClient(), translate_job(None)), _Deps(env))
    assert len(env.tr_reqs) == 1 and result["pages"][0]["ai_state"]["meta"]["model"] == "fake-model"


class _TierDeps:
    pipeline = None

    def __init__(self, prov):
        self.prov, self.tiers = prov, []

    def provider_for(self, tier):
        self.tiers.append(tier)
        return self.prov


def _proof_result():
    return ProofreadResult(
        items=[ProofreadItem(id="t0", suggestion="Xin chào", reason="dấu")], usage=_usage()
    )


def test_proofread_premium_tier_without_cfg_uses_env_tier():
    deps = _TierDeps(SeqProvider([_proof_result()]))
    job = proofread_job([PAGE], [r.model_dump() for r in REGIONS], tier="premium")
    assert run_job(_ImgClient(), job, HANDLERS, deps) == "succeeded"
    assert deps.tiers == ["premium"]


def test_proofread_with_cfg_uses_slot_provider(fake_factory, monkeypatch):
    slot = SeqProvider([_proof_result()])
    monkeypatch.setattr(llm_cache, "provider_from_config", lambda c: slot)
    deps = _TierDeps(SeqProvider([]))
    job = proofread_job([PAGE], [r.model_dump() for r in REGIONS])
    del job["payload"]["model_tier"]
    job["payload"]["llm"] = {
        "proofread": {"provider_id": "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a70", "model": "m"}
    }
    job["llm"] = {"proofread": cfg()}
    assert run_job(_ImgClient(), job, HANDLERS, deps) == "succeeded"
    assert deps.tiers == [] and len(slot.reqs) == 1


def test_payload_slot_without_claim_cfg_fails_auth_not_env():
    deps = _TierDeps(SeqProvider([]))
    job = proofread_job([PAGE], [r.model_dump() for r in REGIONS])
    del job["payload"]["model_tier"]
    job["payload"]["llm"] = {
        "proofread": {"provider_id": "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a70", "model": "m"}
    }
    c = _ImgClient()
    assert run_job(c, job, HANDLERS, deps) == "failed"
    assert c.calls[-1][1]["error_class"] == "auth" and deps.tiers == []


def test_no_env_key_and_no_cfg_fails_auth(monkeypatch):
    for v in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(v, raising=False)
    deps = RuntimeDeps("gemini", 0)
    c = _ImgClient()
    job = proofread_job([PAGE], [r.model_dump() for r in REGIONS])
    assert run_job(c, job, HANDLERS, deps) == "failed"
    f = c.calls[-1][1]
    assert f["error_class"] == "auth" and "chưa cấu hình provider AI" in f["message"]
    assert f["message"].startswith(LLM_NOT_CONFIGURED)


# ---------- key không lộ ----------


def test_job_key_redacted_in_logs_and_fail_message_then_forgotten(monkeypatch, caplog):
    secret = "plain-key-without-known-prefix-777"

    class Leaky:
        name, model = "openai", "m"

        def proofread_page(self, req):
            log = logging.getLogger("mtl_worker")
            log.warning("gọi lỗi với %s", secret)
            raise ProviderError("provider", f"boom {secret}", provider="openai", status=500)

    monkeypatch.setattr(llm_cache, "provider_from_config", lambda c: Leaky())
    caplog.set_level(logging.INFO, logger="mtl_worker")
    caplog.handler.setFormatter(log_redact.RedactingFormatter("%(message)s"))
    job = proofread_job([PAGE], [r.model_dump() for r in REGIONS])
    del job["payload"]["model_tier"]
    job["payload"]["llm"] = {
        "proofread": {"provider_id": "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a70", "model": "m"}
    }
    job["llm"] = {"proofread": cfg(key=secret)}
    c = _ImgClient()
    assert run_job(c, job, HANDLERS, _TierDeps(SeqProvider([]))) == "failed"
    assert secret not in caplog.text and "[redacted]" in caplog.text
    assert secret not in repr(c.calls[-1][1])
    assert log_redact.redact(f"x {secret}") == f"x {secret}"  # đã quên sau job


@pytest.fixture
def restore_root_logging():
    root = logging.getLogger()
    handlers, level = list(root.handlers), root.level
    yield
    for h in list(root.handlers):
        root.removeHandler(h)
    for h in handlers:
        root.addHandler(h)
    root.setLevel(level)


def test_env_secrets_survive_job_cleanup(monkeypatch, restore_root_logging):
    monkeypatch.setenv("OPENAI_API_KEY", "env-key-0123456789")
    log_redact.configure_logging(False)
    from mtl_worker.runner import JobContext

    from .test_worker_runner import FakeClient

    job = proofread_job([PAGE], [])
    job["llm"] = {"proofread": cfg(key="job-key-0123456789")}
    ctx = JobContext(FakeClient(), job)
    assert log_redact.redact("job-key-0123456789") != "job-key-0123456789"
    log_redact.forget_secrets(ctx.secrets)
    assert log_redact.redact("env-key-0123456789") != "env-key-0123456789"
    assert log_redact.redact("job-key-0123456789") == "job-key-0123456789"


def test_per_job_clients_ignore_sdk_base_url_env(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://evil.example")
    monkeypatch.setenv("GOOGLE_GEMINI_BASE_URL", "https://evil.example")
    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "true")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://evil.example/v1")
    a = provider_from_config(cfg("anthropic", "claude-haiku-5-5"))
    assert str(a.client.base_url).startswith("https://api.anthropic.com")
    g = provider_from_config(cfg("gemini", "gemini-2.5-flash"))
    assert g.client._api_client.vertexai is False
    assert "generativelanguage.googleapis.com" in g.client._api_client._http_options.base_url
    o = provider_from_config(cfg("openai"))
    assert str(o.client.base_url).startswith("https://api.openai.com/v1")


def test_not_configured_prefix_matches_the_shared_contract():
    """Web nhận diện lỗi thiếu model theo tiền tố này; đổi một phía phải đổi cả phía kia."""
    job_ts = Path(__file__).parents[2] / "packages/shared/src/job.ts"
    assert f'LLM_NOT_CONFIGURED = "{LLM_NOT_CONFIGURED}"' in job_ts.read_text()
