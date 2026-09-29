// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: () => null }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/hooks/use-session", () => ({ useSession: () => ({ status: "unauthenticated" }) }));
vi.mock("@gsap/react", () => ({ useGSAP: vi.fn() }));
vi.mock("gsap/dist/ScrollTrigger", () => ({ ScrollTrigger: { create: vi.fn() } }));
vi.mock("gsap", () => ({ default: { registerPlugin: vi.fn() } }));

describe("landing page server module", () => {
  it("loads without a browser global", async () => {
    const landingModule = await import("./page");
    expect(landingModule.default).toBeTypeOf("function");
  });
});
