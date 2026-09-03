"""Pure exact-minute splitting of remaining task work into session drafts."""

from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from typing import overload

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


def _validate_split_inputs(
    task_id: str, remaining_minutes: int, preferred_session_length: int
) -> None:
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


@dataclass(frozen=True, slots=True)
class SessionSplit(Sequence[SessionDraft]):
    """Lazy, immutable session drafts for one task's remaining work.

    The split metadata is constant-sized.  Draft objects are created only when
    indexed, iterated, or materialized, so an unusually large task cannot make
    the split operation allocate one object per session eagerly.
    """

    task_id: str
    remaining_minutes: int
    preferred_session_length: int

    def __post_init__(self) -> None:
        _validate_split_inputs(self.task_id, self.remaining_minutes, self.preferred_session_length)

    @property
    def session_count(self) -> int:
        """Number of drafts in this split, calculated without materializing it."""

        return (self.remaining_minutes + self.preferred_session_length - 1) // (
            self.preferred_session_length
        )

    def __len__(self) -> int:
        return self.session_count

    @overload
    def __getitem__(self, index: int) -> SessionDraft: ...

    @overload
    def __getitem__(self, index: slice) -> tuple[SessionDraft, ...]: ...

    def __getitem__(self, index: int | slice) -> SessionDraft | tuple[SessionDraft, ...]:
        if isinstance(index, slice):
            return tuple(self._draft_at(item) for item in range(*index.indices(self.session_count)))
        if not isinstance(index, int):
            raise TypeError("session index must be an integer or slice")
        normalized_index = index if index >= 0 else self.session_count + index
        return self._draft_at(normalized_index)

    def __iter__(self) -> Iterator[SessionDraft]:
        return (self._draft_at(index) for index in range(self.session_count))

    def materialize(self) -> tuple[SessionDraft, ...]:
        """Return ordinary immutable drafts for callers with a manageable split."""

        return tuple(self)

    def _draft_at(self, index: int) -> SessionDraft:
        if not 0 <= index < self.session_count:
            raise IndexError("session index out of range")
        remainder = self.remaining_minutes % self.preferred_session_length
        is_final_remainder = remainder != 0 and index == self.session_count - 1
        duration = remainder if is_final_remainder else self.preferred_session_length
        return SessionDraft(
            session_id=f"{self.task_id}-session-{index}",
            task_id=self.task_id,
            duration_minutes=duration,
            session_index=index,
        )


def split_task_sessions(
    task_id: str,
    remaining_minutes: int,
    preferred_session_length: int,
) -> SessionSplit:
    """Split exact remaining task work into stable, fixed-duration session drafts.

    Every complete part uses ``preferred_session_length``.  If the total is not
    evenly divisible, the final part contains the exact remainder; no workload
    is rounded upward.  The returned IDs are deterministic for a task and part
    order, allowing later input assembly to attach deadlines and windows.
    """

    _validate_split_inputs(task_id, remaining_minutes, preferred_session_length)
    return SessionSplit(task_id, remaining_minutes, preferred_session_length)


# Keep the short name available to scheduling callers while retaining the
# explicit name for call sites that split more than one kind of work.
split_task = split_task_sessions
