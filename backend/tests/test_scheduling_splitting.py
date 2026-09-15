from __future__ import annotations

import pytest

from studyflow.scheduling import SessionDraft, SessionSplit, split_task_sessions


def test_splits_work_into_preferred_length_and_exact_remainder() -> None:
    sessions = split_task_sessions("task-123", remaining_minutes=130, preferred_session_length=60)

    assert sessions.materialize() == (
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


def test_large_split_is_lazy_and_supports_count_and_indexing() -> None:
    sessions = split_task_sessions("task", remaining_minutes=2_501, preferred_session_length=10)

    assert isinstance(sessions, SessionSplit)
    assert sessions.session_count == 251
    assert len(sessions) == 251
    assert sessions[0].duration_minutes == 10
    assert sessions[249].duration_minutes == 10
    assert sessions[250].duration_minutes == 1
    assert sessions[-1] == sessions[250]


def test_small_split_iterates_deterministically_and_materializes() -> None:
    first = split_task_sessions("task", remaining_minutes=125, preferred_session_length=60)
    second = split_task_sessions("task", remaining_minutes=125, preferred_session_length=60)

    assert list(first) == list(second)
    assert first.materialize() == tuple(first)


def test_repeated_splits_have_stable_order_and_identities() -> None:
    sessions = split_task_sessions("task", remaining_minutes=125, preferred_session_length=60)

    assert [session.session_id for session in sessions] == [
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


def test_session_draft_validates_inputs() -> None:
    with pytest.raises(ValueError, match="session_id must not be empty"):
        SessionDraft("", "task", 60, 0)
    with pytest.raises(ValueError, match="task_id must not be empty"):
        SessionDraft("session-1", "", 60, 0)
    with pytest.raises(ValueError, match="duration_minutes must be positive"):
        SessionDraft("session-1", "task", 0, 0)
    with pytest.raises(ValueError, match="duration_minutes must be positive"):
        SessionDraft("session-1", "task", -10, 0)
    with pytest.raises(ValueError, match="session_index must not be negative"):
        SessionDraft("session-1", "task", 60, -1)
    with pytest.raises(TypeError, match="duration_minutes must be an integer"):
        SessionDraft("session-1", "task", "60", 0)  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="session_index must be an integer"):
        SessionDraft("session-1", "task", 60, "0")  # type: ignore[arg-type]


def test_session_split_supports_slicing_and_rejects_invalid_index() -> None:
    split = split_task_sessions("task", remaining_minutes=150, preferred_session_length=60)
    # len is 3: 60, 60, 30

    sliced = split[0:2]
    assert isinstance(sliced, tuple)
    assert len(sliced) == 2
    assert sliced[0].duration_minutes == 60
    assert sliced[1].duration_minutes == 60

    with pytest.raises(TypeError, match="session index must be an integer or slice"):
        split["0"]  # type: ignore[call-overload]

    with pytest.raises(IndexError, match="session index out of range"):
        split[5]

    with pytest.raises(IndexError, match="session index out of range"):
        split[-10]
