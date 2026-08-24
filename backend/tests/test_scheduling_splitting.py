from __future__ import annotations

import pytest

from studyflow.scheduling import MAX_SUPPORTED_SESSION_COUNT, SessionDraft, split_task_sessions


def test_splits_work_into_preferred_length_and_exact_remainder() -> None:
    sessions = split_task_sessions("task-123", remaining_minutes=130, preferred_session_length=60)

    assert sessions == (
        SessionDraft("task-123-session-0", "task-123", 60, 0),
        SessionDraft("task-123-session-1", "task-123", 60, 1),
        SessionDraft("task-123-session-2", "task-123", 10, 2),
    )
    assert sum(session.duration_minutes for session in sessions) == 130


def test_work_shorter_than_preference_stays_one_session() -> None:
    sessions = split_task_sessions("task", remaining_minutes=10, preferred_session_length=60)

    assert len(sessions) == 1
    assert sessions[0].duration_minutes == 10


def test_exact_divisibility_has_no_short_remainder_session() -> None:
    sessions = split_task_sessions("task", remaining_minutes=120, preferred_session_length=60)

    assert [session.duration_minutes for session in sessions] == [60, 60]
    assert sum(session.duration_minutes for session in sessions) == 120


def test_accepts_supported_session_count_and_rejects_one_more() -> None:
    maximum_work = MAX_SUPPORTED_SESSION_COUNT * 10

    sessions = split_task_sessions("task", maximum_work, preferred_session_length=10)

    assert len(sessions) == MAX_SUPPORTED_SESSION_COUNT
    assert sum(session.duration_minutes for session in sessions) == maximum_work
    with pytest.raises(ValueError, match="maximum supported"):
        split_task_sessions("task", maximum_work + 1, preferred_session_length=10)


def test_repeated_splits_have_stable_order_and_identities() -> None:
    first = split_task_sessions("task", remaining_minutes=125, preferred_session_length=60)
    second = split_task_sessions("task", remaining_minutes=125, preferred_session_length=60)

    assert first == second
    assert [session.session_id for session in first] == [
        "task-session-0",
        "task-session-1",
        "task-session-2",
    ]


@pytest.mark.parametrize(
    ("task_id", "remaining_minutes", "preferred_session_length"),
    [
        ("", 30, 60),
        ("   ", 30, 60),
        ("task", 0, 60),
        ("task", -1, 60),
        ("task", 30, 0),
        ("task", 30, 9),
        ("task", 30, 241),
    ],
)
def test_rejects_invalid_split_inputs(
    task_id: str, remaining_minutes: int, preferred_session_length: int
) -> None:
    with pytest.raises(ValueError):
        split_task_sessions(task_id, remaining_minutes, preferred_session_length)


@pytest.mark.parametrize(
    ("remaining_minutes", "preferred_session_length"),
    [(True, 60), (30.0, 60), (30, True), (30, 60.0)],
)
def test_rejects_non_integer_minute_values(
    remaining_minutes: object, preferred_session_length: object
) -> None:
    with pytest.raises(TypeError):
        split_task_sessions("task", remaining_minutes, preferred_session_length)  # type: ignore[arg-type]
