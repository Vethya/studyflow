"""Schedule proposal generation and preview endpoints."""

from datetime import datetime
from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from studyflow.api.account import AccountError, require_csrf_session, require_session
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.availability.unavailable import UnavailablePeriod, UnavailablePeriods
from studyflow.scheduling.acceptance import ScheduleAcceptance, StaleScheduleProposalError
from studyflow.scheduling.assembly import (
    AvailabilityTimezoneConfirmationRequiredError,
    SchedulingInputError,
    SchedulingInputTooLargeError,
)
from studyflow.scheduling.proposals import (
    ProposalExpiredError,
    ProposalKind,
    ProposalNotFeasibleError,
    ProposalScheduleConflictError,
    ProposalStatus,
    ScheduleProposalRecord,
    ScheduleProposalRepository,
    TaskAllocationRecord,
)
from studyflow.scheduling.scenarios import (
    ScenarioAvailabilityWindow,
    ScenarioBlockedPeriod,
    ScenarioDeadlineOverride,
    ScenarioValidationError,
    ScheduleScenario,
)
from studyflow.scheduling.service import (
    ScheduleGeneration,
    ScheduleGenerationFailedError,
)
from studyflow.tasks.service import AcademicTaskRecord, AcademicTasks

router = APIRouter(prefix="/schedule-proposals", tags=["Schedule Proposals"])


class ProposedSessionResponse(BaseModel):
    id: UUID
    task_id: UUID
    task_title: str | None
    starts_at: datetime
    ends_at: datetime
    planned_duration_minutes: int


class TaskAllocationResponse(BaseModel):
    task_id: UUID
    task_title: str | None
    deadline_at: datetime
    required_minutes: int
    scheduled_minutes: int
    unscheduled_minutes: int
    raw_calendar_capacity_minutes: int
    available_minutes_before_deadline: int
    shortfall_minutes: int


class UnscheduledWorkResponse(BaseModel):
    task_id: UUID
    task_title: str | None
    required_minutes: int
    available_minutes_before_deadline: int
    shortfall_minutes: int
    unscheduled_minutes: int


class RelevantUnavailablePeriodResponse(BaseModel):
    id: UUID
    starts_at: datetime
    ends_at: datetime
    reason: str | None


class OverloadWarningResponse(BaseModel):
    affected_tasks: list[UnscheduledWorkResponse]
    relevant_unavailable_periods: list[RelevantUnavailablePeriodResponse]
    remedies: list[Literal["extend_deadline", "add_availability"]]


class ScenarioAvailabilityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    starts_at: datetime
    ends_at: datetime


class ScenarioBlockedPeriodRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    starts_at: datetime
    ends_at: datetime
    reason: str | None = Field(default=None, max_length=200)


class ScenarioDeadlineOverrideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: UUID
    deadline_at: datetime


class ScheduleScenarioRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    temporary_availability: list[ScenarioAvailabilityRequest] = Field(
        default_factory=list, max_length=32
    )
    temporary_blocked_periods: list[ScenarioBlockedPeriodRequest] = Field(
        default_factory=list, max_length=32
    )
    deadline_overrides: list[ScenarioDeadlineOverrideRequest] = Field(
        default_factory=list, max_length=64
    )

    def to_domain(self) -> ScheduleScenario:
        return ScheduleScenario(
            temporary_availability=tuple(
                ScenarioAvailabilityWindow(item.starts_at, item.ends_at)
                for item in self.temporary_availability
            ),
            temporary_blocked_periods=tuple(
                ScenarioBlockedPeriod(item.starts_at, item.ends_at, item.reason)
                for item in self.temporary_blocked_periods
            ),
            deadline_overrides=tuple(
                ScenarioDeadlineOverride(item.task_id, item.deadline_at)
                for item in self.deadline_overrides
            ),
        ).normalized()


class ScheduleProposalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario: ScheduleScenarioRequest | None = None


class ScenarioAvailabilityResponse(BaseModel):
    starts_at: datetime
    ends_at: datetime


class ScenarioBlockedPeriodResponse(BaseModel):
    starts_at: datetime
    ends_at: datetime
    reason: str | None


class ScenarioDeadlineOverrideResponse(BaseModel):
    task_id: UUID
    deadline_at: datetime


class ScheduleScenarioResponse(BaseModel):
    temporary_availability: list[ScenarioAvailabilityResponse]
    temporary_blocked_periods: list[ScenarioBlockedPeriodResponse]
    deadline_overrides: list[ScenarioDeadlineOverrideResponse]


class ScheduleProposalResponse(BaseModel):
    id: UUID
    kind: ProposalKind
    revision_reason: str | None
    status: ProposalStatus
    created_at: datetime
    sessions: list[ProposedSessionResponse]
    task_allocations: list[TaskAllocationResponse]
    unscheduled_work: list[UnscheduledWorkResponse]
    overload_warning: OverloadWarningResponse | None
    scenario: ScheduleScenarioResponse | None = None


class ScheduleSimulationResponse(BaseModel):
    proposal: ScheduleProposalResponse
    active_schedule_changed: Literal[False] = False
    requires_user_review: Literal[False] = False
    persisted: Literal[False] = False


class ScheduleProposalError(BaseModel):
    detail: str


class AcceptedScheduleResponse(BaseModel):
    sessions: list[ProposedSessionResponse]


def get_schedule_generation(request: Request) -> ScheduleGeneration:
    return cast(ScheduleGeneration, request.app.state.schedule_generation)


def get_schedule_proposals(request: Request) -> ScheduleProposalRepository:
    return cast(ScheduleProposalRepository, request.app.state.schedule_proposals)


def get_schedule_acceptance(request: Request) -> ScheduleAcceptance:
    return cast(ScheduleAcceptance, request.app.state.schedule_acceptance)


def get_academic_tasks(request: Request) -> AcademicTasks:
    return cast(AcademicTasks, request.app.state.academic_tasks)


def get_unavailable_periods(request: Request) -> UnavailablePeriods:
    return cast(UnavailablePeriods, request.app.state.unavailable_periods)


def _allocation_response(
    allocation: TaskAllocationRecord, titles: dict[UUID, str]
) -> TaskAllocationResponse:
    return TaskAllocationResponse(
        task_id=allocation.task_id,
        task_title=titles.get(allocation.task_id),
        deadline_at=allocation.deadline_at,
        required_minutes=allocation.required_minutes,
        scheduled_minutes=allocation.scheduled_minutes,
        unscheduled_minutes=allocation.unscheduled_minutes,
        raw_calendar_capacity_minutes=allocation.raw_calendar_capacity_minutes,
        available_minutes_before_deadline=allocation.available_minutes_before_deadline,
        shortfall_minutes=allocation.shortfall_minutes,
    )


def _unscheduled_response(
    allocation: TaskAllocationRecord, titles: dict[UUID, str]
) -> UnscheduledWorkResponse:
    return UnscheduledWorkResponse(
        task_id=allocation.task_id,
        task_title=titles.get(allocation.task_id),
        required_minutes=allocation.required_minutes,
        available_minutes_before_deadline=allocation.available_minutes_before_deadline,
        shortfall_minutes=allocation.shortfall_minutes,
        unscheduled_minutes=allocation.unscheduled_minutes,
    )


def _response(
    proposal: ScheduleProposalRecord,
    tasks: list[AcademicTaskRecord],
    unavailable_periods: list[UnavailablePeriod],
) -> ScheduleProposalResponse:
    titles = {task.id: task.title for task in tasks}
    ordered_allocations = sorted(
        proposal.allocations, key=lambda item: (item.deadline_at, item.task_id)
    )
    allocations = [_allocation_response(item, titles) for item in ordered_allocations]
    unscheduled = [
        _unscheduled_response(item, titles)
        for item in ordered_allocations
        if item.unscheduled_minutes > 0
    ]
    warning = (
        OverloadWarningResponse(
            affected_tasks=unscheduled,
            relevant_unavailable_periods=[
                RelevantUnavailablePeriodResponse(
                    id=period.id,
                    starts_at=period.starts_at,
                    ends_at=period.ends_at,
                    reason=period.reason,
                )
                for period in sorted(
                    unavailable_periods,
                    key=lambda item: (item.starts_at, item.ends_at, item.id),
                )
                if period.ends_at > proposal.created_at
                and any(
                    period.starts_at < allocation.deadline_at
                    for allocation in ordered_allocations
                    if allocation.unscheduled_minutes > 0
                )
            ],
            remedies=["extend_deadline", "add_availability"],
        )
        if proposal.status is ProposalStatus.OVERLOAD
        else None
    )
    return ScheduleProposalResponse(
        id=proposal.id,
        kind=proposal.kind,
        revision_reason=proposal.revision_reason,
        status=proposal.status,
        created_at=proposal.created_at,
        sessions=[
            ProposedSessionResponse(
                id=item.id,
                task_id=item.task_id,
                task_title=titles.get(item.task_id),
                starts_at=item.starts_at,
                ends_at=item.ends_at,
                planned_duration_minutes=item.planned_duration_minutes,
            )
            for item in sorted(proposal.sessions, key=lambda value: (value.starts_at, value.id))
        ],
        task_allocations=allocations,
        unscheduled_work=unscheduled,
        overload_warning=warning,
        scenario=(
            ScheduleScenarioResponse(
                temporary_availability=[
                    ScenarioAvailabilityResponse(starts_at=item.starts_at, ends_at=item.ends_at)
                    for item in proposal.scenario.temporary_availability
                ],
                temporary_blocked_periods=[
                    ScenarioBlockedPeriodResponse(
                        starts_at=item.starts_at,
                        ends_at=item.ends_at,
                        reason=item.reason,
                    )
                    for item in proposal.scenario.temporary_blocked_periods
                ],
                deadline_overrides=[
                    ScenarioDeadlineOverrideResponse(
                        task_id=item.task_id, deadline_at=item.deadline_at
                    )
                    for item in proposal.scenario.deadline_overrides
                ],
            )
            if proposal.scenario is not None
            else None
        ),
    )


def _scenario_from_request(
    payload: ScheduleProposalRequest | None, *, required: bool = False
) -> ScheduleScenario | None:
    if payload is None or payload.scenario is None:
        if required:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A scenario is required for simulation",
            )
        return None
    try:
        return payload.scenario.to_domain()
    except ScenarioValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)
        ) from error


async def schedule_proposal_response(
    proposal: ScheduleProposalRecord,
    account_id: UUID,
    tasks: AcademicTasks,
    unavailable: UnavailablePeriods,
) -> ScheduleProposalResponse:
    task_records = await tasks.list(account_id)
    unavailable_periods = (
        await unavailable.list_periods(account_id)
        if proposal.status is ProposalStatus.OVERLOAD
        else []
    )
    return _response(proposal, task_records, unavailable_periods)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=ScheduleProposalResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": ScheduleProposalError},
        status.HTTP_409_CONFLICT: {"model": ScheduleProposalError},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ScheduleProposalError},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ScheduleProposalError},
    },
)
async def generate_schedule_proposal(
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    generation: Annotated[ScheduleGeneration, Depends(get_schedule_generation)],
    tasks: Annotated[AcademicTasks, Depends(get_academic_tasks)],
    unavailable: Annotated[UnavailablePeriods, Depends(get_unavailable_periods)],
    payload: ScheduleProposalRequest | None = None,
) -> ScheduleProposalResponse:
    scenario = _scenario_from_request(payload)
    try:
        proposal = await generation.generate(principal.account_id, scenario=scenario)
    except AvailabilityTimezoneConfirmationRequiredError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except ScenarioValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)
        ) from error
    except SchedulingInputTooLargeError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)
        ) from error
    except SchedulingInputError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)
        ) from error
    except ScheduleGenerationFailedError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
        ) from error
    if proposal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return await schedule_proposal_response(proposal, principal.account_id, tasks, unavailable)


@router.post(
    "/simulate",
    response_model=ScheduleSimulationResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": ScheduleProposalError},
        status.HTTP_409_CONFLICT: {"model": ScheduleProposalError},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ScheduleProposalError},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ScheduleProposalError},
    },
)
async def simulate_schedule(
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    generation: Annotated[ScheduleGeneration, Depends(get_schedule_generation)],
    tasks: Annotated[AcademicTasks, Depends(get_academic_tasks)],
    unavailable: Annotated[UnavailablePeriods, Depends(get_unavailable_periods)],
    payload: ScheduleProposalRequest | None = None,
) -> ScheduleSimulationResponse:
    scenario = _scenario_from_request(payload, required=True)
    if scenario is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A scenario is required for simulation",
        )
    try:
        proposal = await generation.simulate(principal.account_id, scenario)
    except AvailabilityTimezoneConfirmationRequiredError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except ScenarioValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)
        ) from error
    except SchedulingInputTooLargeError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)
        ) from error
    except SchedulingInputError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)
        ) from error
    except ScheduleGenerationFailedError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
        ) from error
    if proposal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return ScheduleSimulationResponse(
        proposal=await schedule_proposal_response(
            proposal, principal.account_id, tasks, unavailable
        )
    )


@router.get(
    "/current",
    response_model=ScheduleProposalResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": ScheduleProposalError},
    },
)
async def get_current_schedule_proposal(
    principal: Annotated[SessionPrincipal, Depends(require_session)],
    proposals: Annotated[ScheduleProposalRepository, Depends(get_schedule_proposals)],
    tasks: Annotated[AcademicTasks, Depends(get_academic_tasks)],
    unavailable: Annotated[UnavailablePeriods, Depends(get_unavailable_periods)],
) -> ScheduleProposalResponse:
    proposal = await proposals.get(principal.account_id)
    if proposal is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Schedule proposal not found"
        )
    return await schedule_proposal_response(proposal, principal.account_id, tasks, unavailable)


@router.post(
    "/{proposal_id}/accept",
    response_model=AcceptedScheduleResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": ScheduleProposalError},
        status.HTTP_409_CONFLICT: {"model": ScheduleProposalError},
    },
)
async def accept_schedule_proposal(
    proposal_id: UUID,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    acceptance: Annotated[ScheduleAcceptance, Depends(get_schedule_acceptance)],
    tasks: Annotated[AcademicTasks, Depends(get_academic_tasks)],
) -> AcceptedScheduleResponse:
    try:
        sessions = await acceptance.accept(principal.account_id, proposal_id)
    except (
        ProposalNotFeasibleError,
        ProposalExpiredError,
        ProposalScheduleConflictError,
        StaleScheduleProposalError,
    ) as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    if sessions is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found")
    titles = {task.id: task.title for task in await tasks.list(principal.account_id)}
    return AcceptedScheduleResponse(
        sessions=[
            ProposedSessionResponse(
                id=item.id,
                task_id=item.task_id,
                task_title=titles.get(item.task_id),
                starts_at=item.starts_at,
                ends_at=item.ends_at,
                planned_duration_minutes=item.planned_duration_minutes,
            )
            for item in sorted(sessions, key=lambda value: (value.starts_at, value.id))
        ]
    )


@router.post(
    "/{proposal_id}/reject",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": ScheduleProposalError},
    },
)
async def reject_schedule_proposal(
    proposal_id: UUID,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    acceptance: Annotated[ScheduleAcceptance, Depends(get_schedule_acceptance)],
) -> None:
    if not await acceptance.reject(principal.account_id, proposal_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found")
