/**
 * Side effects for the end of a focus phase: a soft synthesized chime and an
 * optional system notification. Both fail quietly; a timer must never break
 * because a browser blocks audio or notifications.
 */

type AudioContextConstructor = typeof AudioContext;

let context: AudioContext | null = null;

function audioContextClass(): AudioContextConstructor | undefined {
  const scope = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

/**
 * Browsers only let audio start after a user gesture, so the context is
 * created (or resumed) from the click that starts the timer.
 */
export function primeChime(): void {
  try {
    const Context = audioContextClass();
    if (!Context) return;
    context ??= new Context();
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch {
    context = null;
  }
}

/** Two gentle sine tones, a fifth apart, fading out over about a second. */
export function playChime(): void {
  try {
    if (!context) primeChime();
    if (!context) return;
    const start = context.currentTime;
    [523.25, 783.99].forEach((frequency, index) => {
      const at = start + index * 0.18;
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(at);
      oscillator.stop(at + 1.2);
    });
  } catch {
    // Audio is a nicety; the toast still tells the student the phase ended.
  }
}

export function notificationsSupported(): boolean {
  return "Notification" in window;
}

/** Asks for permission; resolves true only when the browser grants it. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  try {
    if (Notification.permission === "granted") return true;
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** Shown only while the page is in the background; the toast covers the visible case. */
export function showPhaseNotification(title: string, body: string): void {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  try {
    new Notification(title, { body, tag: "studyflow-focus-timer" });
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}

/** Test helper: drop the shared audio context. */
export function resetChime(): void {
  context = null;
}
