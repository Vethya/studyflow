// @vitest-environment jsdom
import React from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placeCard, ProductTour, TOUR_STEPS } from "./product-tour";

const flags = vi.hoisted(() => ({
  seen: false,
  account: { id: "account-1" } as { id: string } | null,
  listeners: new Set<() => void>(),
  requests: new Set<() => void>(),
}));

vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ account: flags.account }),
}));

vi.mock("@/lib/onboarding", () => ({
  subscribeToOnboardingFlags: (listener: () => void) => {
    flags.listeners.add(listener);
    return () => flags.listeners.delete(listener);
  },
  productTourSeen: (accountId: string | null) => accountId === null || flags.seen,
  rememberProductTourSeen: (accountId: string | null) => {
    if (accountId === null) return;
    flags.seen = true;
    flags.listeners.forEach((listener) => listener());
  },
  onProductTourRequest: (listener: () => void) => {
    flags.requests.add(listener);
    return () => flags.requests.delete(listener);
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props} onClick={(event) => { event.preventDefault(); props.onClick?.(event); }}>{children}</a>
  ),
}));

const dialog = () => screen.getByRole("dialog");
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
const goTo = (id: string) => {
  const target = TOUR_STEPS.findIndex((step) => step.id === id);
  for (let i = 0; i < target; i += 1) press("ArrowRight");
};

/** A highlighted control; jsdom has no layout, so its box is given. */
function Target({ name, box }: { name: string; box: Partial<DOMRect> }) {
  const ref = React.useCallback((element: HTMLButtonElement | null) => {
    if (element) element.getBoundingClientRect = () => ({ top: 0, left: 0, width: 0, height: 0, ...box }) as DOMRect;
  }, [box]);
  return <button ref={ref} data-tour={name}>{name}</button>;
}

beforeEach(() => {
  flags.seen = false;
  flags.account = { id: "account-1" };
  flags.listeners.clear();
  flags.requests.clear();
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProductTour", () => {
  it("stays out of the server render and away once it has been seen", () => {
    expect(renderToString(<ProductTour />)).toBe("");
    flags.seen = true;
    render(<ProductTour />);
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    flags.account = null;
    flags.seen = false;
    render(<ProductTour />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens by itself on a first visit and walks through every step", async () => {
    render(<ProductTour />);
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("heading", { name: "Welcome to StudyFlow" })).toBeTruthy();
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeTruthy();
    const start = screen.getByRole("button", { name: /Start the tour/ });
    await waitFor(() => expect(document.activeElement).toBe(start));

    fireEvent.click(start);
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();
    // Nothing on the page to point at, so the card sits in the middle.
    expect(screen.queryByTestId("tour-spotlight")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByRole("heading", { name: "Welcome to StudyFlow" })).toBeTruthy();

    for (let i = 1; i < TOUR_STEPS.length; i += 1) fireEvent.click(screen.getByRole("button", { name: /Next|Start the tour/ }));
    expect(screen.getByRole("heading", { name: "You are ready" })).toBeTruthy();
    press("ArrowRight");
    expect(screen.getByRole("heading", { name: "You are ready" })).toBeTruthy();
    const cta = screen.getByText("Set my study hours").closest("a") as HTMLAnchorElement;
    expect(cta.getAttribute("href")).toBe("/availability");
    fireEvent.click(cta);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(flags.seen).toBe(true);
  });

  it("can be skipped from the first step, the close button, Escape, or the last step", () => {
    const view = render(<ProductTour />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => flags.requests.forEach((request) => request()));
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => flags.requests.forEach((request) => request()));
    press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => flags.requests.forEach((request) => request()));
    goTo("done");
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.unmount();
  });

  it("replays from the start when asked, even after it was seen", () => {
    flags.seen = true;
    render(<ProductTour />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => flags.requests.forEach((request) => request()));
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeTruthy();
  });

  it("highlights the control it describes and follows it on resize and scroll", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <>
        <Target name="nav-dashboard" box={{ top: 100, left: 16, width: 200, height: 36 }} />
        <Target name="nav-tasks" box={{ top: 0, left: 0, width: 0, height: 0 }} />
        <ProductTour />
      </>,
    );
    goTo("dashboard");
    const spotlight = await screen.findByTestId("tour-spotlight");
    expect(spotlight.style.top).toBe("94px");
    expect(spotlight.style.width).toBe("212px");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    fireEvent(window, new Event("resize"));
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.getByTestId("tour-spotlight")).toBeTruthy());

    // A control that is collapsed away gets the centred card instead.
    press("ArrowRight");
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("tour-spotlight")).toBeNull());
    press("ArrowLeft");
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it("keeps focus inside the card and app shortcuts from firing behind it", () => {
    const shortcut = vi.fn();
    render(<ProductTour />);
    goTo("tasks");
    const close = screen.getByRole("button", { name: "Skip tour" });
    const back = screen.getByRole("button", { name: /Back/ });
    const next = screen.getByRole("button", { name: /Next/ });

    next.focus();
    press("Tab");
    expect(document.activeElement).toBe(close);
    press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(next);
    back.focus();
    press("Tab");
    expect(document.activeElement).toBe(back);

    window.addEventListener("keydown", shortcut);
    press("n");
    press("?");
    expect(shortcut).not.toHaveBeenCalled();
    press(" ");
    press("Enter");
    expect(shortcut).toHaveBeenCalledTimes(2);
    window.removeEventListener("keydown", shortcut);
  });
});

describe("placeCard", () => {
  const card = { width: 320, height: 200 };
  const viewport = { width: 1280, height: 800 };

  it("puts the card to the right of sidebar items, kept on screen", () => {
    expect(placeCard({ top: 100, left: 10, width: 200, height: 40 }, card, viewport)).toEqual({ top: 20, left: 224 });
    expect(placeCard({ top: 760, left: 10, width: 200, height: 40 }, card, viewport)).toEqual({ top: 584, left: 224 });
  });

  it("puts the card below header controls", () => {
    expect(placeCard({ top: 10, left: 600, width: 260, height: 40 }, card, viewport)).toEqual({ top: 64, left: 570 });
    expect(placeCard({ top: 10, left: 1220, width: 40, height: 40 }, card, viewport)).toEqual({ top: 64, left: 944 });
  });

  it("falls back to the right, then above, when there is no room below", () => {
    expect(placeCard({ top: 700, left: 500, width: 100, height: 60 }, card, viewport)).toEqual({ top: 584, left: 614 });
    expect(placeCard({ top: 700, left: 1000, width: 100, height: 60 }, card, viewport)).toEqual({ top: 486, left: 890 });
    expect(placeCard({ top: 100, left: 1000, width: 100, height: 690 }, card, viewport)).toEqual({ top: 16, left: 890 });
  });
});
