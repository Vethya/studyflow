// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ status: "loading" }));
vi.mock("@/hooks/use-session", () => ({ useSession: () => ({ status: state.status }) }));

import LandingPage from "./page";
import { NavAuth } from "@/components/landing/nav-auth";
import { demoCapacity, demoDays } from "@/components/landing/demo-data";

beforeEach(() => { state.status = "loading"; });
afterEach(cleanup);

describe("landing page", () => {
  it("renders the current product sections, navigation and signup links", () => {
    const { container } = render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Know if your week fits" })).toBeTruthy();
    expect(screen.getAllByText("Get started for free").length).toBeGreaterThan(0);
    expect(screen.getByText("Coming soon")).toBeTruthy();
    const features = within(container.querySelector<HTMLElement>("#features")!);
    for (const name of ["Tell it when you’re free", "Add your coursework", "Find the hours you’re short"]) {
      expect(features.getByRole("heading", { level: 3, name })).toBeTruthy();
    }
    expect(screen.getByRole("heading", { name: "Stop finding out the night before" })).toBeTruthy();
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
    expect(container.querySelector("img")).toBeNull();
  });

  it("describes each product preview with inert visual content", () => {
    const { container } = render(<LandingPage />);
    const labels = [
      "This week: 18 hours of coursework, 14 hours available, 4 hours short. Start the essay on Tuesday to catch up.",
      "Free hours for Monday to Friday, with Wednesday blocked for a midterm and two study sessions.",
      "Four tasks due this week totalling 18 hours, with daily workload and deadlines.",
      "This week: 18 hours of work against 14 hours of study time, with 4 hours short. Your Linear Algebra problem set needs 3 more hours than you have before Friday.",
    ];
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(4);
    expect(container.querySelectorAll('[role="img"] > div[inert]')).toHaveLength(4);
    for (const label of labels) {
      const preview = screen.getByRole("img", { name: label });
      expect(preview.hasAttribute("inert")).toBe(false);
      expect(preview.firstElementChild?.hasAttribute("inert")).toBe(true);
    }
    expect(demoDays.reduce((sum, day) => sum + day.free, 0)).toBe(demoCapacity.available);
    expect(demoDays.reduce((sum, day) => sum + day.planned, 0)).toBe(demoCapacity.committed);
    const hero = within(screen.getByRole("img", { name: labels[0] }));
    expect(hero.getByText("18h")).toBeTruthy();
    expect(hero.getByText("14h")).toBeTruthy();
    expect(hero.getByText("4h short this week.")).toBeTruthy();
  });

  it("applies staggered hero motion and section reveals", () => {
    const { container } = render(<LandingPage />);
    const heroElements = container.querySelectorAll<HTMLElement>(".landing-rise");
    expect(Array.from(heroElements, (element) => element.style.getPropertyValue("--landing-delay"))).toEqual(["", "120ms", "240ms", "360ms"]);
    expect(container.querySelectorAll(".landing-reveal")).toHaveLength(12);
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
