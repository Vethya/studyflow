"""Adaptive-estimation contracts and pure model calculations."""

from studyflow.estimation.model import (
    CorrectionPrediction,
    EstimateBasis,
    EstimationAccuracy,
    HistoryRecord,
    PredictionEvaluation,
    adaptive_correction,
    category_correction_factor,
    estimation_accuracy,
    qualifies,
    size_bucket,
)
from studyflow.estimation.repositories import AdaptivePredictionRepository
from studyflow.estimation.service import (
    AdaptiveEligibilityStatus,
    AdaptiveEstimatePreview,
    AdaptiveEstimateUnavailableError,
    AdaptiveEstimator,
    AdaptivePredictionCaptureError,
)

__all__ = [
    "AdaptiveEligibilityStatus",
    "AdaptiveEstimatePreview",
    "AdaptiveEstimateUnavailableError",
    "AdaptiveEstimator",
    "AdaptivePredictionCaptureError",
    "AdaptivePredictionRepository",
    "CorrectionPrediction",
    "EstimateBasis",
    "EstimationAccuracy",
    "HistoryRecord",
    "PredictionEvaluation",
    "adaptive_correction",
    "category_correction_factor",
    "estimation_accuracy",
    "qualifies",
    "size_bucket",
]
