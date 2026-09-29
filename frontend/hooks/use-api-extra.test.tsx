// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { describeError, useApi } from "./use-api";

afterEach(cleanup);

function Probe({ loader }: { loader: (signal: AbortSignal) => Promise<any> }) {
  const resource = useApi("extra-api-key", loader);
  return (
    <div>
      <output>{resource.error ? describeError(resource.error) : String(resource.data)}</output>
      <button onClick={() => resource.setData((current) => `${current ?? "empty"}-updated`)}>update</button>
    </div>
  );
}

describe("useApi remaining branches", () => {
  it("formats unknown errors and applies functional cache updates", async () => {
    expect(describeError({ raw: "failure" })).toBe("Something went wrong. Please try again.");

    const success = vi.fn().mockResolvedValue("value");
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Probe loader={success} /></SWRConfig>);
    await waitFor(() => expect(screen.getByText("value")).toBeTruthy());
    act(() => screen.getByRole("button", { name: "update" }).click());
    expect(screen.getByText("value-updated")).toBeTruthy();
  });

  it("normalizes non-Error loader rejections", async () => {
    const failing = vi.fn().mockRejectedValue({ code: "failure" });
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Probe loader={failing} /></SWRConfig>);
    await waitFor(() => expect(screen.getByText("[object Object]")).toBeTruthy());
  });

  it("passes null to functional updates before the first response", () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((accept) => { resolve = accept; });
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Probe loader={() => pending} /></SWRConfig>);
    act(() => screen.getByRole("button", { name: "update" }).click());
    expect(screen.getByText("empty-updated")).toBeTruthy();
    resolve("later");
  });
});
