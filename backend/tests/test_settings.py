from pathlib import Path

from pytest import MonkeyPatch

from studyflow.app import create_app
from studyflow.settings import Environment, Settings


def test_settings_read_studyflow_prefixed_environment_variables(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("STUDYFLOW_ENVIRONMENT", "test")
    monkeypatch.setenv("STUDYFLOW_DEBUG", "true")
    monkeypatch.setenv("STUDYFLOW_LOG_LEVEL", "DEBUG")

    settings = Settings()

    assert settings.environment is Environment.TEST
    assert settings.debug is True
    assert settings.log_level == "DEBUG"


def test_app_factory_uses_explicit_settings() -> None:
    settings = Settings(environment=Environment.TEST, debug=True)

    app = create_app(settings)

    assert app.debug is True
    assert app.state.settings is settings
