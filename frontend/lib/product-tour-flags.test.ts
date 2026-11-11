// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import {
  onProductTourRequest,
  productTourSeen,
  rememberProductTourSeen,
  startProductTour,
  subscribeToOnboardingFlags,
} from "./onboarding";

it("remembers the tour once it has been seen, and tells subscribers", () => {
  localStorage.clear();
  expect(productTourSeen(null)).toBe(true);
  expect(productTourSeen("account-1")).toBe(false);
  const listener = vi.fn();
  const unsubscribe = subscribeToOnboardingFlags(listener);
  rememberProductTourSeen(null);
  expect(productTourSeen("account-1")).toBe(false);
  rememberProductTourSeen("account-1");
  expect(productTourSeen("account-1")).toBe(true);
  expect(productTourSeen("account-2")).toBe(false);
  expect(localStorage.getItem("studyflow:tour-seen:account-1")).toBe("1");
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
});

it("passes replay requests to whoever is listening", () => {
  const listener = vi.fn();
  const stop = onProductTourRequest(listener);
  startProductTour();
  expect(listener).toHaveBeenCalledOnce();
  stop();
  startProductTour();
  expect(listener).toHaveBeenCalledOnce();
});
