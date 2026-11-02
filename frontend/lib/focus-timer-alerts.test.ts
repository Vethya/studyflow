// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  notificationsSupported,
  playChime,
  primeChime,
  requestNotificationPermission,
  resetChime,
  showPhaseNotification,
} from "./focus-timer-alerts";

function fakeAudio(state: AudioContextState = "running", resume = () => Promise.resolve()) {
  const oscillators: { start: ReturnType<typeof vi.fn>; frequency: { value: number } }[] = [];
  const created = vi.fn();
  class FakeContext {
    state = state;
    currentTime = 1;
    destination = {};
    resume = vi.fn(resume);
    constructor() { created(this); }
    createOscillator() {
      const node = { type: "", frequency: { value: 0 }, connect: (next: unknown) => next, start: vi.fn(), stop: vi.fn() };
      oscillators.push(node);
      return node;
    }
    createGain() {
      return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: (next: unknown) => next };
    }
  }
  return { FakeContext, created, oscillators };
}

beforeEach(() => resetChime());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chime", () => {
  it("plays two tones through a context created on demand", () => {
    const audio = fakeAudio();
    vi.stubGlobal("AudioContext", audio.FakeContext);
    playChime();
    expect(audio.created).toHaveBeenCalledTimes(1);
    expect(audio.oscillators.map((node) => node.frequency.value)).toEqual([523.25, 783.99]);
    primeChime();
    playChime();
    expect(audio.created).toHaveBeenCalledTimes(1);
  });

  it("resumes a suspended context, ignoring a refused resume", async () => {
    const audio = fakeAudio("suspended", () => Promise.reject(new Error("no")));
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", audio.FakeContext);
    primeChime();
    const context = audio.created.mock.calls[0][0] as { resume: ReturnType<typeof vi.fn> };
    expect(context.resume).toHaveBeenCalled();
    await Promise.resolve();
  });

  it("does nothing without Web Audio and survives failures", () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    expect(() => playChime()).not.toThrow();

    vi.stubGlobal("AudioContext", class { constructor() { throw new Error("blocked"); } });
    expect(() => playChime()).not.toThrow();

    const broken = fakeAudio();
    broken.FakeContext.prototype.createOscillator = () => { throw new Error("closed"); };
    vi.stubGlobal("AudioContext", broken.FakeContext);
    expect(() => playChime()).not.toThrow();
  });
});

describe("notifications", () => {
  function stubNotification(permission: NotificationPermission, request?: () => Promise<NotificationPermission>) {
    const constructed = vi.fn();
    class FakeNotification {
      static permission = permission;
      static requestPermission = vi.fn(request ?? (() => Promise.resolve(permission)));
      constructor(title: string, options: NotificationOptions) { constructed(title, options); }
    }
    vi.stubGlobal("Notification", FakeNotification);
    return { FakeNotification, constructed };
  }

  it("reports support", () => {
    stubNotification("default");
    expect(notificationsSupported()).toBe(true);
    // @ts-expect-error removing the global for the unsupported case
    delete window.Notification;
    expect(notificationsSupported()).toBe(false);
  });

  it("requests permission only when needed", async () => {
    // @ts-expect-error removing the global for the unsupported case
    delete window.Notification;
    expect(await requestNotificationPermission()).toBe(false);

    stubNotification("granted");
    expect(await requestNotificationPermission()).toBe(true);

    stubNotification("default", () => Promise.resolve("granted"));
    expect(await requestNotificationPermission()).toBe(true);
    stubNotification("default", () => Promise.resolve("denied"));
    expect(await requestNotificationPermission()).toBe(false);
    stubNotification("default", () => Promise.reject(new Error("old browser")));
    expect(await requestNotificationPermission()).toBe(false);
  });

  it("shows a notification only when granted and the page is hidden", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    // @ts-expect-error removing the global for the unsupported case
    delete window.Notification;
    showPhaseNotification("a", "b");

    const denied = stubNotification("denied");
    visibility.mockReturnValue("hidden");
    showPhaseNotification("a", "b");
    expect(denied.constructed).not.toHaveBeenCalled();

    const granted = stubNotification("granted");
    visibility.mockReturnValue("visible");
    showPhaseNotification("a", "b");
    expect(granted.constructed).not.toHaveBeenCalled();
    visibility.mockReturnValue("hidden");
    showPhaseNotification("Focus round done", "Break");
    expect(granted.constructed).toHaveBeenCalledWith("Focus round done", { body: "Break", tag: "studyflow-focus-timer" });

    granted.constructed.mockImplementation(() => { throw new Error("use a service worker"); });
    expect(() => showPhaseNotification("a", "b")).not.toThrow();
  });
});
