import { createStudyFlowTools } from "./tools";
import { getWebMcpModelContext } from "./types";

export interface WebMcpRegistration {
  ready: Promise<void>;
  dispose: () => void;
}

/** Register tools for the lifetime of the authenticated app shell. */
export function startStudyFlowWebMcp(): WebMcpRegistration | null {
  const modelContext = getWebMcpModelContext();
  if (modelContext === null) return null;

  const controller = new AbortController();
  const ready = (async () => {
    await Promise.all(
      createStudyFlowTools().map((tool) =>
        Promise.resolve(modelContext.registerTool(tool, { signal: controller.signal })),
      ),
    );
  })();

  return {
    ready,
    dispose: () => controller.abort(),
  };
}
