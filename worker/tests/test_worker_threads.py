"""Số luồng onnxruntime mặc định: MTL_THREADS > chia nhân CPU cho MTL_WORKERS replica > 0 (onnxruntime tự chọn)."""

from __future__ import annotations

import os

import pytest

from mtl_worker import main
from mtl_worker.main import default_threads, parse_args


@pytest.fixture
def cpus(monkeypatch: pytest.MonkeyPatch):
    def set_cpus(n: int) -> None:
        monkeypatch.setattr(main, "_cpu_count", lambda: n)

    return set_cpus


def test_single_worker_lets_onnxruntime_choose(cpus) -> None:
    cpus(8)
    assert default_threads({}) == 0
    assert default_threads({"MTL_WORKERS": "1"}) == 0


def test_splits_cores_between_workers(cpus) -> None:
    cpus(8)
    assert default_threads({"MTL_WORKERS": "2"}) == 4
    cpus(12)
    assert default_threads({"MTL_WORKERS": "2"}) == 6
    cpus(7)
    assert default_threads({"MTL_WORKERS": "2"}) == 3


def test_never_below_one_thread(cpus) -> None:
    cpus(4)
    assert default_threads({"MTL_WORKERS": "16"}) == 1


def test_mtl_threads_wins_over_workers(cpus) -> None:
    cpus(8)
    assert default_threads({"MTL_THREADS": "3", "MTL_WORKERS": "2"}) == 3
    assert default_threads({"MTL_THREADS": "0", "MTL_WORKERS": "2"}) == 0


def test_blank_values_fall_back_to_defaults(cpus) -> None:
    cpus(8)
    assert default_threads({"MTL_THREADS": "", "MTL_WORKERS": " "}) == 0


@pytest.mark.parametrize("env", [{"MTL_THREADS": "abc"}, {"MTL_THREADS": "-1"}, {"MTL_WORKERS": "0"}])
def test_invalid_values_exit_with_the_variable_name(env: dict[str, str]) -> None:
    with pytest.raises(SystemExit, match=next(iter(env))):
        default_threads(env)


def test_threads_flag_wins_over_env(cpus, monkeypatch: pytest.MonkeyPatch) -> None:
    cpus(8)
    monkeypatch.delenv("MTL_THREADS", raising=False)
    monkeypatch.setenv("MTL_WORKERS", "2")
    assert parse_args(["--api", "http://x"]).threads == 4
    assert parse_args(["--api", "http://x", "--threads", "2"]).threads == 2
    # Env sai không chặn cờ tường minh.
    monkeypatch.setenv("MTL_THREADS", "abc")
    assert parse_args(["--api", "http://x", "--threads", "2"]).threads == 2


def test_cpu_count_falls_back_without_sched_getaffinity(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delattr(os, "sched_getaffinity", raising=False)
    monkeypatch.setattr(os, "cpu_count", lambda: 5)
    assert main._cpu_count() == 5
    monkeypatch.setattr(os, "cpu_count", lambda: None)
    assert main._cpu_count() == 1
