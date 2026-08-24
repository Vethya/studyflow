from __future__ import annotations

import json
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

from studyflow.app import create_app
from studyflow.settings import Environment, Settings

REPOSITORY_ROOT = Path(__file__).parents[2]
COLLECTION_PATH = REPOSITORY_ROOT / "postman" / "StudyFlow.postman_collection.json"
ENVIRONMENTS_PATH = REPOSITORY_ROOT / "postman" / "environments"


def load_json(path: Path) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads(path.read_text()))


def iter_requests(items: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    for item in items:
        if request := item.get("request"):
            yield cast(dict[str, Any], request)
        yield from iter_requests(cast(list[dict[str, Any]], item.get("item", [])))


def normalize_postman_path(raw_url: str) -> str:
    path = raw_url.removeprefix("{{base_url}}").partition("?")[0]
    return re.sub(r"\{\{([^}]+)\}\}", r"{\1}", path)


def find_item(items: list[dict[str, Any]], name: str) -> dict[str, Any]:
    for item in items:
        if item.get("name") == name:
            return item
        if found := find_item(cast(list[dict[str, Any]], item.get("item", [])), name):
            return found
    return {}


def test_postman_collection_matches_the_openapi_endpoint_set() -> None:
    collection = load_json(COLLECTION_PATH)
    postman_operations = {
        (
            request["method"].lower(),
            normalize_postman_path(request["url"]["raw"]),
        )
        for request in iter_requests(collection["item"])
    }
    application = create_app(settings=Settings(environment=Environment.TEST))
    openapi_operations = {
        (method, path)
        for path, path_item in application.openapi()["paths"].items()
        for method in path_item
    }
    openapi_operations.add(("get", application.openapi_url))

    assert postman_operations == openapi_operations


def test_postman_environments_are_complete_and_safe_by_default() -> None:
    environments = {path.stem: load_json(path) for path in ENVIRONMENTS_PATH.glob("*.json")}

    assert set(environments) == {
        "Development.postman_environment",
        "Local.postman_environment",
        "Production.postman_environment",
    }
    for name, environment in environments.items():
        values = {value["key"]: value["value"] for value in environment["values"]}
        base_url = values["base_url"]
        if name.startswith("Local"):
            assert base_url == "http://127.0.0.1:8000"
        else:
            assert base_url.startswith("https://")


def test_academic_task_requests_generate_a_future_deadline() -> None:
    collection = load_json(COLLECTION_PATH)
    academic_tasks = find_item(collection["item"], "Academic Tasks")
    create_task = find_item(academic_tasks["item"], "Create Academic Task")
    update_task = find_item(academic_tasks["item"], "Update Academic Task")

    prerequest_script = "\n".join(academic_tasks["event"][0]["script"]["exec"])
    create_test_script = "\n".join(create_task["event"][0]["script"]["exec"])

    assert "Date.now() + 7 * 24 * 60 * 60 * 1000" in prerequest_script
    assert "pm.collectionVariables.set('task_deadline_at'" in prerequest_script
    assert "{{task_deadline_at}}" in create_task["request"]["body"]["raw"]
    assert "{{task_deadline_at}}" in update_task["request"]["body"]["raw"]
    assert "Date.parse(pm.collectionVariables.get('task_deadline_at'))" in create_test_script
    assert "pm.expect(deadline).to.be.above(Date.now())" in create_test_script


def test_schedule_acceptance_populates_the_study_session_id() -> None:
    collection = load_json(COLLECTION_PATH)
    scheduling = find_item(collection["item"], "Scheduling")
    acceptance = find_item(scheduling["item"], "Accept Schedule Proposal")

    test_script = "\n".join(acceptance["event"][0]["script"]["exec"])

    assert "pm.response.json().sessions" in test_script
    assert "pm.collectionVariables.set('session_id', sessions[0].id)" in test_script
