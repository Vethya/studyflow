// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import AuthLayout from "@/app/(auth)/layout";

afterEach(cleanup);

it("shows the selected book symbol in the sign-in home link without duplicate accessible text", () => {
  const { container } = render(<AuthLayout><p>Sign in form</p></AuthLayout>);
  const home = screen.getByRole("link", { name: "StudyFlow" });
  const icon = home.querySelector('svg[data-brand-icon="page-flow"]');
  expect(icon).not.toBeNull();
  expect(icon?.getAttribute("aria-hidden")).toBe("true");
  expect(icon?.querySelectorAll("path")).toHaveLength(2);
  expect(icon?.querySelector("text")).toBeNull();
  expect(container.textContent).toContain("Sign in form");
});
