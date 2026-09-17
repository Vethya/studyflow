"""Persistent domain models."""

from studyflow.database.models.authentication import (
    AuthenticationAccountDeletionChallenge,
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
from studyflow.database.models.integrations import GoogleImportSnapshot, GoogleImportState
from studyflow.database.models.scheduling import (
    ProposalTaskAllocation,
    RecoverySnapshotOutcome,
    RecoveryTaskWork,
    ScheduleProposal,
    ScheduleRecoverySnapshot,
    StudySession,
    StudySessionOutcome,
)
from studyflow.database.models.tasks import (
    AcademicTask,
    AdaptiveEstimationAcknowledgment,
    AdaptiveEstimationPrediction,
    TaskDeadlineHistory,
)

__all__ = [
    "AcademicTask",
    "AdaptiveEstimationAcknowledgment",
    "AdaptiveEstimationPrediction",
    "AuthenticationAccountDeletionChallenge",
    "AuthenticationEmailToken",
    "AuthenticationIdentity",
    "AuthenticationOIDCLinkChallenge",
    "AuthenticationOIDCState",
    "AuthenticationRateLimit",
    "AuthenticationRegistration",
    "AuthenticationSession",
    "AvailabilityWindow",
    "GoogleImportSnapshot",
    "GoogleImportState",
    "ProposalTaskAllocation",
    "RecoverySnapshotOutcome",
    "RecoveryTaskWork",
    "ScheduleProposal",
    "ScheduleRecoverySnapshot",
    "StudentAccount",
    "StudySession",
    "StudySessionOutcome",
    "TaskDeadlineHistory",
    "UnavailablePeriod",
]
