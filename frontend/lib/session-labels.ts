import type { StudySession } from "@/types/session";
import type { Category } from "@/types/task";

/** What `toStudySession` uses when the API omits `task_title`. */
export const MISSING_SESSION_TITLE = "Untitled task";

/** Shown once the loaded task list has no row for this session. */
export const UNKNOWN_SESSION_TITLE = "Unknown task";

export interface SessionTaskLabel {
  id: string;
  title: string;
  category: Category;
}

/**
 * The accepted-session API on the current backend does not send a task title
 * or category. Pages already load the task list, so fill those in from it.
 * A title the API did send is left alone.
 */
export function labelSessions<T extends Pick<StudySession, "taskId" | "taskTitle" | "category">>(
  sessions: readonly T[],
  tasks: readonly SessionTaskLabel[] | null | undefined,
): T[] {
  if (tasks == null) return sessions as T[];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return sessions.map((session) => {
    if (session.taskTitle !== MISSING_SESSION_TITLE) return session;
    const task = byId.get(session.taskId);
    if (!task) return { ...session, taskTitle: UNKNOWN_SESSION_TITLE };
    return { ...session, taskTitle: task.title, category: task.category };
  });
}
