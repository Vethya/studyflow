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
import { NavAuth } from "@/components/landing/nav-auth";

beforeEach(() => { state.status = "loading"; });
afterEach(cleanup);

describe("landing page", () => {
  it("renders the current product sections, navigation and signup links", () => {
    const { container } = render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Know if your week fits" })).toBeTruthy();
    expect(screen.getAllByText("Get started for free").length).toBeGreaterThan(0);
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(screen.getByText("Your real hours, not an ideal week.")).toBeTruthy();
    expect(screen.getByText("How StudyFlow works")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign up for free" }).getAttribute("href")).toBe("/register");
    for (const [name, href] of [["Features", "#features"], ["How it works", "#how-it-works"], ["Pricing", "#pricing"]]) {
      for (const link of screen.getAllByRole("link", { name })) {
        expect(link.getAttribute("href")).toBe(href);
      }
      expect(container.querySelector(href)).toBeTruthy();
    }
    expect(container.querySelector("a button")).toBeNull();
    expect(screen.getByRole("link", { name: "See how it works" }).getAttribute("href")).toBe("#features");
    expect(container.querySelectorAll("img")).toHaveLength(3);
  });

  it("describes the hero product preview with inert visual content", () => {
    const { container } = render(<LandingPage />);
    const label = "This week: 18 hours of coursework, 14 hours available, 4 hours short. Start the essay on Tuesday to catch up.";
    const preview = screen.getByRole("img", { name: label });
    expect(container.querySelectorAll('[role="img"] > div[inert]')).toHaveLength(1);
    expect(preview.hasAttribute("inert")).toBe(false);
    expect(preview.firstElementChild?.hasAttribute("inert")).toBe(true);
    expect(screen.getByText("18h")).toBeTruthy();
    expect(screen.getByText("14h")).toBeTruthy();
    expect(screen.getByText("4h short this week.")).toBeTruthy();
  });

  it("applies staggered hero motion and section reveals", () => {
    const { container } = render(<LandingPage />);
    const heroElements = container.querySelectorAll<HTMLElement>(".landing-rise");
    expect(Array.from(heroElements, (element) => element.style.getPropertyValue("--landing-delay"))).toEqual(["", "120ms", "240ms", "360ms"]);
    expect(container.querySelectorAll(".landing-reveal")).toHaveLength(9);
  });

  it("keeps the landing wrapper from becoming a scroll container", () => {
    const { container } = render(<LandingPage />);
    const root = container.querySelector(".landing-page");
    expect(root).toBeTruthy();
    // Overflow classes other than overflow-x-clip make the wrapper the view() scroll container.
    expect(Array.from(root!.classList).filter((name) => name.startsWith("overflow-") && name !== "overflow-x-clip")).toEqual([]);
  });
});

describe("NavAuth", () => {
  it("reserves space without auth links while loading", () => {
    const { container } = render(<NavAuth />);
    expect(container.querySelector('[aria-hidden="true"].h-9.w-28')).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("links authenticated students to the dashboard", () => {
    state.status = "authenticated";
    render(<NavAuth />);
    expect(screen.getByRole("link", { name: "Open dashboard" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByRole("link", { name: "Login" })).toBeNull();
  });

  it("offers login and signup to unauthenticated students", () => {
    state.status = "unauthenticated";
    const { container } = render(<NavAuth />);
    expect(screen.getByRole("link", { name: "Login" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe("/register");
    expect(container.querySelector("button")).toBeNull();
  });
});
