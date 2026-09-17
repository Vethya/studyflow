/** Broadcasts data changes made by WebMCP so mounted screens can refresh. */
export const STUDYFLOW_DATA_CHANGED_EVENT = "studyflow:data-changed";

export function notifyStudyFlowDataChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(STUDYFLOW_DATA_CHANGED_EVENT));
  }
}

/** Broadcasts that the server no longer accepts the browser's session. */
export const STUDYFLOW_SESSION_INVALIDATED_EVENT = "studyflow:session-invalidated";
const STUDYFLOW_AUTH_CHANNEL = "studyflow-auth";
const STUDYFLOW_AUTH_MESSAGE = "session-invalidated";
const STUDYFLOW_AUTH_STORAGE_KEY = "studyflow:session-invalidated";

export function notifyStudyFlowSessionInvalidated(): void {
  if (typeof window === "undefined") return;

  window.dispatchEvent(new Event(STUDYFLOW_SESSION_INVALIDATED_EVENT));

  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(STUDYFLOW_AUTH_CHANNEL);
    channel.postMessage(STUDYFLOW_AUTH_MESSAGE);
    channel.close();
  }

  try {
    window.localStorage.setItem(STUDYFLOW_AUTH_STORAGE_KEY, `${Date.now()}-${Math.random()}`);
    window.localStorage.removeItem(STUDYFLOW_AUTH_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

export function subscribeToStudyFlowSessionInvalidation(onInvalidated: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener(STUDYFLOW_SESSION_INVALIDATED_EVENT, onInvalidated);

  const onStorage = (event: StorageEvent) => {
    if (event.key === STUDYFLOW_AUTH_STORAGE_KEY) onInvalidated();
  };
  window.addEventListener("storage", onStorage);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(STUDYFLOW_AUTH_CHANNEL);
    channel.addEventListener("message", (event: MessageEvent) => {
      if (event.data === STUDYFLOW_AUTH_MESSAGE) onInvalidated();
    });
  }

  return () => {
    window.removeEventListener(STUDYFLOW_SESSION_INVALIDATED_EVENT, onInvalidated);
    window.removeEventListener("storage", onStorage);
    channel?.close();
  };
}
