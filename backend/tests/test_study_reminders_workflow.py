from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import yaml

REPOSITORY_ROOT = Path(__file__).parents[2]
WORKFLOW_PATH = REPOSITORY_ROOT / ".github" / "workflows" / "study-reminders.yml"


def load_workflow() -> dict[Any, Any]:
    return cast(dict[Any, Any], yaml.safe_load(WORKFLOW_PATH.read_text()))


def test_reminder_workflow_runs_every_thirty_minutes_and_on_demand() -> None:
    workflow = load_workflow()
    # PyYAML reads the bare "on" key as boolean true.
    triggers = workflow[True]

    assert triggers["schedule"] == [{"cron": "*/30 * * * *"}]
    assert "workflow_dispatch" in triggers
    assert workflow["permissions"] == {}
    assert workflow["concurrency"]["cancel-in-progress"] is False


def test_reminder_workflow_calls_the_dispatch_endpoint_with_secrets() -> None:
    [step] = load_workflow()["jobs"]["dispatch"]["steps"]
    script = step["run"]

    assert step["env"] == {
        "STUDYFLOW_API_URL": "${{ secrets.STUDYFLOW_API_URL }}",
        "STUDYFLOW_REMINDER_DISPATCH_TOKEN": "${{ secrets.STUDYFLOW_REMINDER_DISPATCH_TOKEN }}",
    }
    assert "/api/v1/internal/reminders/dispatch" in script
    assert "Authorization: Bearer ${STUDYFLOW_REMINDER_DISPATCH_TOKEN}" in script
    assert "--max-time 120" in script
    assert "--retry" in script
    assert "::warning" in script and "exit 0" in script
    assert "uses" not in step
