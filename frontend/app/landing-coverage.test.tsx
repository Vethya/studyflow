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

import LandingPage from "./page";

beforeEach(() => { state.status = "loading"; });
afterEach(cleanup);

describe("landing page", () => {
  it("renders all product sections and authentication navigation states", () => {
    const { rerender } = render(<LandingPage />);
    expect(screen.getByRole("heading", { name: /Does it all/ })).toBeTruthy();
    expect(screen.getAllByText("Get started for free").length).toBeGreaterThan(0);
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(screen.getByText("Your real hours, not an ideal week.")).toBeTruthy();
    expect(screen.getByText("How StudyFlow works")).toBeTruthy();
    state.status = "authenticated";
    rerender(<LandingPage />);
    expect(screen.getByText("Open dashboard")).toBeTruthy();
    state.status = "unauthenticated";
    rerender(<LandingPage />);
    expect(screen.getByText("Login")).toBeTruthy();
    expect(screen.getByText("Sign up")).toBeTruthy();
  });
});
