// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ status: "loading" }));

vi.mock("@/hooks/use-session", () => ({ useSession: () => ({ status: state.status }) }));
vi.mock("next/image", () => ({ default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt="" {...props} />;
} }));
vi.mock("@gsap/react", () => ({ useGSAP: (callback: () => void) => { React.useEffect(() => { callback(); }, [callback]); } }));
vi.mock("gsap/dist/ScrollTrigger", () => ({ ScrollTrigger: { create: ({ onEnter }: { onEnter?: () => void }) => { onEnter?.(); } } }));
vi.mock("gsap", () => {
  const animate = (target: unknown, vars?: { val?: number; onUpdate?: () => void }) => {
    if (vars && typeof target === "object" && target !== null && "val" in target && vars.val !== undefined) {
      (target as { val: number }).val = vars.val;
    }
    vars?.onUpdate?.();
    return target;
  };
  const timeline = () => ({ from: () => timeline() });
  return {
    default: {
      registerPlugin: vi.fn(),
      to: animate,
      from: animate,
      set: vi.fn(),
      timeline,
      utils: {
        random: (min: number, max: number) => (min + max) / 2,
        toArray: (selector: string) => Array.from(document.querySelectorAll(selector)),
      },
    },
  };
});

import LandingPage from "./page";

beforeEach(() => {
  state.status = "loading";
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList));
});
afterEach(cleanup);

describe("landing page", () => {
  it("renders all product sections and authentication navigation states", () => {
    const { rerender } = render(<LandingPage />);
    expect(screen.getByRole("heading", { name: /Does it all/ })).toBeTruthy();
    expect(screen.getAllByText("Get started for free").length).toBeGreaterThan(0);
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(screen.getByText("Your real hours, not an ideal week.")).toBeTruthy();
    expect(screen.getByText("How Studyflow works")).toBeTruthy();
    state.status = "authenticated";
    rerender(<LandingPage />);
    expect(screen.getByText("Open dashboard")).toBeTruthy();
    state.status = "unauthenticated";
    rerender(<LandingPage />);
    expect(screen.getByText("Login")).toBeTruthy();
    expect(screen.getByText("Sign up")).toBeTruthy();
  });

  it("skips animation setup for reduced-motion visitors", () => {
    cleanup();
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList));
    render(<LandingPage />);
    expect(screen.getByRole("heading", { name: /Does it all/ })).toBeTruthy();
  });

  it("formats animated stat variants with missing, percent, and fractional data", () => {
    const missing = document.createElement("div");
    missing.className = "stat-number";
    const percent = document.createElement("div");
    percent.className = "stat-number";
    percent.dataset.value = "2";
    percent.dataset.prefix = "~";
    percent.dataset.suffix = "%";
    const fractional = document.createElement("div");
    fractional.className = "stat-number";
    fractional.dataset.value = "2.5";
    document.body.append(missing, percent, fractional);
    render(<LandingPage />);
    expect(percent.textContent).toBe("~2%");
    expect(fractional.textContent).toBe("3");
    cleanup();
    missing.remove();
    percent.remove();
    fractional.remove();
  });
});
