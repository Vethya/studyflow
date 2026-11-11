import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { apiHandler, resetApi } from "./mock-api";

const server = setupServer(apiHandler);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it("restores a signed-out scenario after login and a story remount", async () => {
  const initial = { authenticated: false };
  const request = (path: string, method = "GET") =>
    fetch(`${window.location.origin}/api/v1/auth/${path}`, { method });
  resetApi(initial);
  expect((await request("session")).status).toBe(401);
  expect((await request("login", "POST")).status).toBe(200);
  expect((await request("session")).status).toBe(200);
  resetApi(initial);
  expect((await request("session")).status).toBe(401);
  expect(initial.authenticated).toBe(false);
});
