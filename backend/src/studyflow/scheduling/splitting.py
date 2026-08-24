"""Pure exact-minute splitting of remaining task work into session drafts."""

from dataclasses import dataclass

MIN_PREFERRED_SESSION_LENGTH = 10
MAX_PREFERRED_SESSION_LENGTH = 240


def _require_integer(name: str, value: object) -> int:
    if type(value) is not int:
        raise TypeError(f"{name} must be an integer")
    return value


@dataclass(frozen=True, slots=True)
class SessionDraft:
    """A fixed-duration session before calendar and task metadata is assembled."""

    session_id: str
    task_id: str
    duration_minutes: int
    session_index: int

    def __post_init__(self) -> None:
        if not isinstance(self.session_id, str) or not self.session_id:
            raise ValueError("session_id must not be empty")
        if not isinstance(self.task_id, str) or not self.task_id:
            raise ValueError("task_id must not be empty")
        _require_integer("duration_minutes", self.duration_minutes)
        _require_integer("session_index", self.session_index)
        if self.duration_minutes <= 0:
            raise ValueError("duration_minutes must be positive")
        if self.session_index < 0:
            raise ValueError("session_index must not be negative")


def split_task_sessions(
    task_id: str,
    remaining_minutes: int,
    preferred_session_length: int,
) -> tuple[SessionDraft, ...]:
    """Split exact remaining task work into stable, fixed-duration session drafts.

    Every complete part uses ``preferred_session_length``.  If the total is not
    evenly divisible, the final part contains the exact remainder; no workload
    is rounded upward.  The returned IDs are deterministic for a task and part
    order, allowing later input assembly to attach deadlines and windows.
    """

    if not isinstance(task_id, str) or not task_id.strip():
        raise ValueError("task_id must not be empty")
    remaining = _require_integer("remaining_minutes", remaining_minutes)
    preferred = _require_integer("preferred_session_length", preferred_session_length)
    if remaining <= 0:
        raise ValueError("remaining_minutes must be positive")
    if not MIN_PREFERRED_SESSION_LENGTH <= preferred <= MAX_PREFERRED_SESSION_LENGTH:
        raise ValueError(
            "preferred_session_length must be between "
            f"{MIN_PREFERRED_SESSION_LENGTH} and {MAX_PREFERRED_SESSION_LENGTH} minutes"
        )

    full_sessions, remainder = divmod(remaining, preferred)
    durations = (preferred,) * full_sessions + ((remainder,) if remainder else ())
    return tuple(
        SessionDraft(
            session_id=f"{task_id}-session-{index}",
            task_id=task_id,
            duration_minutes=duration,
            session_index=index,
        )
        for index, duration in enumerate(durations)
    )


# Keep the short name available to scheduling callers while retaining the
# explicit name for call sites that split more than one kind of work.
split_task = split_task_sessions
