// @vitest-environment jsdom
import React, { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { describeError, useApi } from "./use-api";
import { ApiError } from "@/lib/api";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <StrictMode>{children}</StrictMode>
    </SWRConfig>
  );
}

function ResourceProbe({
  resourceKey,
  loader,
}: {
  resourceKey: string | null;
  loader: (signal: AbortSignal) => Promise<string>;
}) {
  const { data, error, isLoading, reload, setData } = useApi(resourceKey, loader);

  return (
    <div>
      <div data-testid="status">
        {isLoading ? "loading" : error ? `error:${describeError(error)}` : `data:${data}`}
      </div>
      <button onClick={() => reload()}>reload</button>
      <button onClick={() => setData("overridden")}>setData</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe("useApi", () => {
  it("loads data successfully even in React StrictMode without aborting", async () => {
    const loader = vi.fn(async (signal: AbortSignal) => {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => resolve("success-data"), 20);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("signal is aborted without reason", "AbortError"));
        });
      });
    });

    render(
      <Wrapper>
        <ResourceProbe resourceKey="test-key-strict" loader={loader} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("data:success-data");
    });
    expect(loader).toHaveBeenCalled();
  });

  it("does not fetch when key is null", async () => {
    const loader = vi.fn().mockResolvedValue("should-not-load");

    render(
      <Wrapper>
        <ResourceProbe resourceKey={null} loader={loader} />
      </Wrapper>,
    );

    expect(screen.getByTestId("status").textContent).toBe("data:null");
    expect(loader).not.toHaveBeenCalled();
  });

  it("handles loader rejections and formats ApiError properly", async () => {
    const apiError = new ApiError(404, "Task not found");
    const loader = vi.fn().mockRejectedValue(apiError);

    render(
      <Wrapper>
        <ResourceProbe resourceKey="test-error-key" loader={loader} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("error:Task not found");
    });
  });

  it("supports manual reload and setData", async () => {
    let count = 0;
    const loader = vi.fn(async () => {
      count++;
      return `count-${count}`;
    });

    render(
      <Wrapper>
        <ResourceProbe resourceKey="test-reload-key" loader={loader} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("data:count-1");
    });

    // Test setData
    act(() => {
      screen.getByText("setData").click();
    });
    expect(screen.getByTestId("status").textContent).toBe("data:overridden");

    // Test reload
    await act(async () => {
      screen.getByText("reload").click();
    });
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("data:count-2");
    });
  });
});
