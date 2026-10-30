from __future__ import annotations

import re
from pathlib import Path
from typing import Any, cast

import pytest
import yaml

REPOSITORY_ROOT = Path(__file__).parents[2]
WORKFLOW_PATH = REPOSITORY_ROOT / ".github" / "workflows" / "frontend-ci.yml"
CLAUSE = re.compile(r"^(github\.event_name|github\.ref) (==|!=) '([^']*)'$")


def load_workflow() -> dict[str, Any]:
    return cast(dict[str, Any], yaml.safe_load(WORKFLOW_PATH.read_text()))


def workflow_triggers(workflow: dict[str, Any]) -> dict[str, Any]:
    # YAML 1.1 reads the bare `on` key as boolean True.
    raw_workflow = cast(dict[object, Any], workflow)
    return cast(dict[str, Any], raw_workflow.get("on", raw_workflow.get(True)))


def job_runs(condition: str, event_name: str, ref: str) -> bool:
    """Evaluate a job `if:` made of `||`-joined equality checks on the event and ref."""
    context = {"github.event_name": event_name, "github.ref": ref}
    for clause in condition.split("||"):
        match = CLAUSE.match(clause.strip())
        assert match is not None, f"unsupported condition clause: {clause!r}"
        name, operator, value = match.groups()
        if (context[name] == value) == (operator == "=="):
            return True
    return False


def test_frontend_ci_uses_read_only_permissions_and_concurrency() -> None:
    workflow = load_workflow()

    assert workflow["permissions"] == {"contents": "read"}
    assert workflow["concurrency"]["cancel-in-progress"] is True


def test_frontend_quality_gates_run_on_every_push_pull_request_and_manual_run() -> None:
    workflow = load_workflow()
    triggers = workflow_triggers(workflow)

    assert "branches" not in triggers["push"]
    assert "branches" not in triggers["pull_request"]
    assert "workflow_dispatch" in triggers
    assert "if" not in workflow["jobs"]["quality"]


@pytest.mark.parametrize(
    ("event_name", "ref", "expected"),
    [
        ("pull_request", "refs/pull/61/merge", True),
        ("push", "refs/heads/master", True),
        ("push", "refs/heads/dev", True),
        ("workflow_dispatch", "refs/heads/dev", True),
        ("workflow_dispatch", "refs/heads/feature/example", True),
        ("push", "refs/heads/feature/example", False),
    ],
)
def test_smoke_test_covers_pull_requests_integrated_branches_and_manual_runs(
    event_name: str, ref: str, expected: bool
) -> None:
    smoke = load_workflow()["jobs"]["smoke"]

    assert smoke["needs"] == "quality"
    assert job_runs(smoke["if"], event_name, ref) is expected


def test_frontend_ci_pins_actions_by_sha() -> None:
    for job in load_workflow()["jobs"].values():
        for step in job["steps"]:
            if action := step.get("uses"):
                assert re.fullmatch(r"[^@]+@[0-9a-f]{40}", action)
