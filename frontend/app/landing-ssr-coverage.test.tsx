// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: () => null }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/hooks/use-session", () => ({ useSession: () => ({ status: "unauthenticated" }) }));

describe("landing page server module", () => {
  // A cold import of the whole landing page; under coverage on a busy machine it can pass 20s.
  it("loads without a browser global", { timeout: 60_000 }, async () => {
    const landingModule = await import("./page");
    expect(landingModule.default).toBeTypeOf("function");
  });
});
