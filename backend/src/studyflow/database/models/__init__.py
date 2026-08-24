"""Persistent domain models."""

from studyflow.database.models.authentication import (
    AuthenticationEmailToken,
    AuthenticationIdentity,
    AuthenticationOIDCLinkChallenge,
    AuthenticationOIDCState,
    AuthenticationRateLimit,
    AuthenticationRegistration,
    AuthenticationSession,
    StudentAccount,
)
from studyflow.database.models.availability import AvailabilityWindow, UnavailablePeriod
from studyflow.database.models.scheduling import (
    ProposalTaskAllocation,
    RecoveryTaskWork,
    ScheduleProposal,
    ScheduleRecoverySnapshot,
    StudySession,
    StudySessionOutcome,
)
from studyflow.database.models.tasks import AcademicTask, TaskDeadlineHistory

__all__ = [
    "AcademicTask",
    "AuthenticationEmailToken",
    "AuthenticationIdentity",
    "AuthenticationOIDCLinkChallenge",
    "AuthenticationOIDCState",
    "AuthenticationRateLimit",
    "AuthenticationRegistration",
    "AuthenticationSession",
    "AvailabilityWindow",
    "ProposalTaskAllocation",
    "RecoveryTaskWork",
    "ScheduleProposal",
    "ScheduleRecoverySnapshot",
    "StudentAccount",
    "StudySession",
    "StudySessionOutcome",
    "TaskDeadlineHistory",
    "UnavailablePeriod",
]
