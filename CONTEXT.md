# StudyFlow

StudyFlow helps university students turn academic work into feasible, adaptable study plans.

## Language

**Student Account**:
The personal identity and planning preferences of StudyFlow's only direct user type. The student may manage their name, password, Account Timezone, Preferred Session Length, Minimum Session Length, and Minimum Break.
_Avoid_: Adviser account, administrator account

**Academic Task**:
A student-owned piece of academic work with a title, Deadline, Priority, Category, and expected total duration. It may include an optional Course label and plain-text Notes for organization; neither affects scheduling or adaptive estimation.
_Avoid_: To-do, event

**Completed Task**:
An Academic Task with no remaining work. It results when all planned work is completed or the student confirms that the task finished earlier than expected; future Study Sessions are then removed.
_Avoid_: Completed Session

**Overdue Task**:
An Academic Task whose Deadline has passed while work remains. Its remaining work stays unscheduled until the student provides a new Deadline.
_Avoid_: Overload

**Task Status**:
The automatically derived lifecycle state of an Academic Task: Not Started, In Progress, Completed, or Overdue. At Risk is an Overload warning, not a Task Status.
_Avoid_: Session Outcome

**Deadline**:
The exact local date and time by which all work for an Academic Task must be completed. No Study Session for the task may end after it.
_Avoid_: Target date

**Account Timezone**:
The student's selected timezone used to interpret all deadlines, availability, and Study Sessions.
_Avoid_: Device timezone

**Priority**:
The student's Low, Medium, or High assessment of an Academic Task's academic importance. It defaults to Medium and does not represent deadline urgency.
_Avoid_: Urgency

**Category**:
A fixed academic classification for an Academic Task: Assignment, Reading, Exam Preparation, Project, Research/Writing, or Other.
_Avoid_: Tag

**Original Estimate**:
The student's initial prediction of an Academic Task's total required duration. It may be corrected before the first Study Session begins, then is frozen as the static evaluation baseline.
_Avoid_: Planned Duration

**Adaptive Estimate**:
StudyFlow's prediction of an Academic Task's total required duration based only on the student's earlier completion history. It is explicitly unavailable until sufficient history exists.
_Avoid_: Original Estimate

**Planned Duration**:
The Original Estimate or available Adaptive Estimate selected to determine an Academic Task's scheduled workload. It uses Original Estimate while Adaptive Estimate is unavailable; afterward Adaptive Estimate is the default, but the student may choose Original Estimate.
_Avoid_: Actual Duration

**Actual Duration**:
The total time actually worked across all Study Sessions for an Academic Task, including time from Delayed sessions. Missed sessions contribute no time.
_Avoid_: Planned Duration

**Effort Progress**:
The share of a task's currently expected total effort already worked, calculated from Actual Duration relative to Actual Duration plus estimated remaining duration. It does not represent content completion, quality, or grade.
_Avoid_: Academic performance

**Urgency**:
The time pressure StudyFlow derives from an Academic Task's deadline and remaining workload. Urgency takes precedence over Priority when scheduling overloaded work.
_Avoid_: Priority

**Availability Window**:
A recurring weekly period during which the student permits Study Sessions to be scheduled. It may cross midnight while remaining one student-visible window.
_Avoid_: Free time

**Unavailable Period**:
A dated exception during which Study Sessions must not be scheduled. It overrides any overlapping Availability Window.
_Avoid_: Availability

**Study Session**:
A planned period of work representing all or part of an Academic Task. Every Academic Task is represented by one or more Study Sessions.
_Avoid_: Task, calendar event

**Pinned Session**:
A Study Session whose placement was chosen by the student and must remain unchanged during Schedule Revision until the student unpins it.
_Avoid_: Fixed task

**Preferred Session Length**:
The maximum duration a student prefers for Study Sessions. It defaults to sixty minutes and may be changed for the account or overridden for an individual Academic Task.
_Avoid_: Task duration, estimated duration

**Minimum Session Length**:
The shortest uninterrupted period the student considers useful for a Study Session. It defaults to twenty minutes. StudyFlow rebalances split work to avoid smaller fragments, except when the entire Academic Task is shorter than this minimum; an Academic Task may override the account preference.
_Avoid_: Preferred Session Length

**Minimum Break**:
The shortest rest period the student wants between consecutive Study Sessions. It defaults to ten minutes and may be set to zero.
_Avoid_: Unavailable Period

**Session Outcome**:
The student's record of what happened during a Study Session: Completed, Delayed, or Missed.
_Avoid_: Task status

**Awaiting Outcome**:
The condition of a past Study Session for which the student has not recorded a Session Outcome. Its work remains outstanding, but it contributes no behavior data.
_Avoid_: Missed

**Study Timer**:
Optional Start, Pause, and Finish assistance that measures time worked during a Study Session. Its measured duration is confirmed or edited by the student and never determines the Session Outcome.
_Avoid_: Session Outcome

**Completed**:
A Session Outcome indicating that the session's planned work was finished. Actual Duration is positive and no work remains.

**Delayed**:
A Session Outcome indicating that some work occurred but the session's planned work was not finished. Both time already spent and expected remaining duration are positive.
_Avoid_: Missed

**Missed**:
A Session Outcome indicating that no work occurred. Actual Duration is zero and all of the session's planned work remains to be rescheduled.
_Avoid_: Delayed

**Schedule Revision**:
A proposed replacement for future Study Sessions after work or availability changes. It explains affected sessions and becomes the student's plan only after acceptance; the student may instead override it.
_Avoid_: Silent reschedule

**Unscheduled Work**:
Remaining work that currently has no valid Study Session. It stays visible with an explanation until the student accepts a feasible placement or changes the relevant constraints.
_Avoid_: Missed Session

**Overload**:
A condition where an Academic Task's required remaining work cannot fit within the student's available time before its deadline. Excess work remains unscheduled, and the explanation identifies required time, available time, shortfall, relevant constraints, and student-controlled remedies.
_Avoid_: Scheduling conflict, invalid schedule
