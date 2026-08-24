from dataclasses import dataclass
from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid4

import pytest

from studyflow.accounts.preferences import AccountPreferences, StudyPreferences
from studyflow.availability.unavailable import UnavailablePeriods
from studyflow.availability.windows import AvailabilityWindows
from studyflow.scheduling import (
    ProposalKind,
    ProposalStatus,
    ScheduleAcceptanceService,
    StaleScheduleProposalError,
    schedule_input_fingerprint,
)
from studyflow.scheduling.proposals import ScheduleProposalRecord, ScheduleProposalRepository
from studyflow.tasks.service import AcademicTasks

ACCOUNT_ID = UUID("00000000-0000-0000-0000-000000000001")


class TasksStub:
    async def list(self, account_id: UUID, filters: object = None):  # type: ignore[no-untyped-def]
        return []


class WindowsStub:
    async def list_windows(self, account_id: UUID):  # type: ignore[no-untyped-def]
        return []


class PeriodsStub:
    async def list_periods(self, account_id: UUID):  # type: ignore[no-untyped-def]
        return []


@dataclass
class PreferencesStub:
    value: StudyPreferences

    async def get(self, account_id: UUID) -> StudyPreferences:
        return self.value


@dataclass
class RepositoryStub:
    proposal: ScheduleProposalRecord
    accept_calls: list[tuple[UUID, UUID, datetime]]

    async def get(self, account_id: UUID) -> ScheduleProposalRecord:
        return self.proposal

    async def accept(self, account_id: UUID, proposal_id: UUID, now: datetime):  # type: ignore[no-untyped-def]
        self.accept_calls.append((account_id, proposal_id, now))
        return ()

    async def reject(self, account_id: UUID, proposal_id: UUID) -> bool:
        return True


def _service(
    preferences: StudyPreferences, fingerprint: str
) -> tuple[ScheduleAcceptanceService, RepositoryStub]:
    proposal = ScheduleProposalRecord(
        uuid4(),
        ACCOUNT_ID,
        ProposalKind.GENERATION,
        None,
        ProposalStatus.FEASIBLE,
        fingerprint,
        datetime(2026, 8, 24, tzinfo=UTC),
        (),
        (),
    )
    repository = RepositoryStub(proposal, [])
    service = ScheduleAcceptanceService(
        cast(AcademicTasks, TasksStub()),
        cast(AvailabilityWindows, WindowsStub()),
        cast(UnavailablePeriods, PeriodsStub()),
        cast(AccountPreferences, PreferencesStub(preferences)),
        cast(ScheduleProposalRepository, repository),
        clock=lambda: datetime(2026, 8, 25, tzinfo=UTC),
    )
    return service, repository


@pytest.mark.anyio
async def test_accept_recomputes_fingerprint_before_repository_mutation() -> None:
    preferences = StudyPreferences("UTC", 60, 10, False)
    fingerprint = schedule_input_fingerprint([], [], [], preferences)
    service, repository = _service(preferences, fingerprint)

    assert await service.accept(ACCOUNT_ID, repository.proposal.id) == ()
    assert len(repository.accept_calls) == 1


@pytest.mark.anyio
async def test_accept_rejects_stale_proposal_before_repository_mutation() -> None:
    preferences = StudyPreferences("UTC", 60, 10, False)
    service, repository = _service(preferences, "a" * 64)

    with pytest.raises(StaleScheduleProposalError, match="changed"):
        await service.accept(ACCOUNT_ID, repository.proposal.id)
    assert repository.accept_calls == []
