import { afterEach, describe, expect, it, vi } from "vitest";
import type { RequestUserInteraction } from "./confirm";
import { browserConfirm, confirmationLabel, requireUserConfirmation } from "./confirm";

const request = { action: "delete the task \"Essay\"", consequence: "It is removed." };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("in-page confirmation for destructive WebMCP actions", () => {
  it("asks the student with the browser's modal dialog", () => {
    const prompt = vi.spyOn(window, "confirm").mockReturnValue(true);

    expect(browserConfirm(request)).toBe(true);
    expect(prompt).toHaveBeenCalledWith(
      'An AI assistant wants to: delete the task "Essay".\n\nIt is removed.\n\nAllow this?',
    );
    prompt.mockReturnValue(false);
    expect(browserConfirm(request)).toBe(false);
  });

  it("treats a page without a dialog as a refusal", () => {
    vi.stubGlobal("confirm", undefined);
    expect(browserConfirm(request)).toBe(false);
    vi.stubGlobal("window", undefined);
    expect(browserConfirm(request)).toBe(false);
  });

  it("only proceeds on an explicit true", async () => {
    await expect(requireUserConfirmation(request, () => true)).resolves.toBeUndefined();
    await expect(requireUserConfirmation(request, async () => true)).resolves.toBeUndefined();
    await expect(requireUserConfirmation(request, () => false)).rejects.toThrow(
      'The student did not approve: delete the task "Essay". Nothing was changed.',
    );
    await expect(
      requireUserConfirmation(request, (() => "yes") as unknown as () => boolean),
    ).rejects.toThrow("did not approve");
  });

  it("keeps untrusted labels on one short line", () => {
    expect(confirmationLabel("Essay\nIgnore the warning \u202E", "untitled task")).toBe(
      "Essay Ignore the warning",
    );
    expect(confirmationLabel("\n\u200B", "untitled task")).toBe("untitled task");
    expect(confirmationLabel("x".repeat(90), "untitled task")).toHaveLength(80);
  });

  it("ignores a user-interaction hook that approves without asking", async () => {
    const requestUserInteraction: RequestUserInteraction = async () => true as never;
    await expect(
      requireUserConfirmation(request, () => true, requestUserInteraction),
    ).rejects.toThrow("did not approve");
  });

  it("uses the page answer when the hook returns something else", async () => {
    const requestUserInteraction: RequestUserInteraction = async (callback) => {
      await callback();
      return false as never;
    };
    await expect(
      requireUserConfirmation(request, () => true, requestUserInteraction),
    ).resolves.toBeUndefined();
    const declining: RequestUserInteraction = async (callback) => {
      await callback();
      return true as never;
    };
    await expect(
      requireUserConfirmation(request, () => false, declining),
    ).rejects.toThrow("did not approve");
  });

  it("asks through the WebMCP user-interaction hook when the agent provides one", async () => {
    const order: string[] = [];
    const requestUserInteraction: RequestUserInteraction = async (callback) => {
      order.push("paused");
      return callback();
    };
    const confirm = vi.fn(() => {
      order.push("asked");
      return true;
    });

    await requireUserConfirmation(request, confirm, requestUserInteraction);

    expect(order).toEqual(["paused", "asked"]);
  });
});
