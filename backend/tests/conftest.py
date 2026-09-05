"""Pytest shared test fixtures and test isolation."""

from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolate_test_settings_environment(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Isolate tests from ambient developer .env values and working directory."""
    monkeypatch.chdir(tmp_path)
