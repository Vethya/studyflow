import type {
  AcademicTask,
  AvailabilityWindow,
  EffortProgress,
  Schedule,
  UnavailablePeriod,
} from "@/types";
import type { ScheduleProposal } from "@/types/schedule";

/** Keep these stable once agents can discover them. */
export const WEBMCP_TOOL_NAMES = {
  getPlanState: "studyflow_get_plan_state",
  addTask: "studyflow_add_task",
  simulatePlan: "studyflow_simulate_plan",
  draftPlan: "studyflow_draft_plan",
  acceptPlan: "studyflow_accept_plan",
  rejectPlan: "studyflow_reject_plan",
  recordMissed: "studyflow_record_missed",
  updateStudyTime: "studyflow_update_study_time",
  updateTask: "studyflow_update_task",
} as const;

export type WebMcpToolName = (typeof WEBMCP_TOOL_NAMES)[keyof typeof WEBMCP_TOOL_NAMES];

/** A one-off window used only for a hypothetical plan. */
export interface TemporaryStudyWindow {
  starts_at: string;
  ends_at: string;
}

/** A one-off block used only for a hypothetical plan. */
export interface TemporaryBlockedPeriod {
  starts_at: string;
  ends_at: string;
  reason?: string;
}

export interface DeadlineOverride {
  task_id: string;
  deadline_at: string;
}

/** Never persisted as recurring availability. Used by simulate and draft. */
export interface ScenarioOverrides {
  temporary_availability?: TemporaryStudyWindow[];
  temporary_blocked_periods?: TemporaryBlockedPeriod[];
  deadline_overrides?: DeadlineOverride[];
}

export type PlanSetupStatus =
  | "ready"
  | "needs_availability"
  | "needs_timezone_confirmation"
  | "needs_tasks";

export interface PlanCapacity {
  horizon_days: 7 | 14 | 30;
  available_minutes: number;
  committed_minutes: number;
  balance_minutes: number;
}

/** One read gives the agent enough context to choose its next action. */
export interface PlanState {
  as_of: string;
  timezone: string;
  planning_preferences: PlanningPreferences;
  setup_status: PlanSetupStatus;
  capacity: PlanCapacity;
  tasks: AcademicTask[];
  availability_windows: AvailabilityWindow[];
  unavailable_periods: UnavailablePeriod[];
  active_schedule: Schedule | null;
  pending_proposal: ScheduleProposal | null;
  progress: EffortProgress[];
}

export interface PlanningPreferences {
  timezone: string;
  preferred_session_length_minutes: number;
  minimum_break_minutes: number;
  availability_confirmation_required: boolean;
}

export interface WebMcpResultMeta {
  active_schedule_changed: boolean;
  requires_user_review: boolean;
  persisted: boolean;
}

export interface WebMcpResult<T> extends WebMcpResultMeta {
  data: T;
}

export interface SimulatePlanResult {
  scenario: ScenarioOverrides;
  proposal: ScheduleProposal;
}

export interface DraftPlanResult {
  proposal: ScheduleProposal;
}

export interface AcceptPlanResult {
  schedule: Schedule;
}

export interface RejectPlanResult {
  proposal_id: string;
}

export interface RecordMissedResult {
  session_id: string;
  recovery_proposal: ScheduleProposal | null;
}

export interface StudyTimeUpdateResult {
  timezone_confirmed: boolean;
  planning_preferences: PlanningPreferences | null;
  recurring_windows: AvailabilityWindow[] | null;
  added_blocked_periods: UnavailablePeriod[];
  updated_blocked_periods: UnavailablePeriod[];
  removed_blocked_period_ids: string[];
  invalidated_future_session_ids: string[];
}

export type TaskOperation = "edit" | "delete" | "start" | "finish_early";

export interface UpdateTaskResult {
  operation: TaskOperation;
  task_id: string;
  task: AcademicTask | null;
  deleted: boolean;
}
