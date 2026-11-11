// @vitest-environment node
import React from "react";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { ThemeProvider } from "./theme-provider";

it("puts the CSP nonce on next-themes' server-rendered theme script", () => {
  // next-themes only emits the nonce on the server; browsers hide it after parsing.
  const html = renderToString(
    <ThemeProvider nonce="test-nonce">
      <p>child</p>
    </ThemeProvider>,
  );
  expect(html).toContain("<p>child</p>");
  expect(html).toMatch(/<script[^>]*nonce="test-nonce"/);
});
