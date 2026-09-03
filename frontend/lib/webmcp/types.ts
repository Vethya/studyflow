export type JsonSchema = Record<string, unknown>;

export interface WebMcpToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface WebMcpToolExecutionOptions {
  signal: AbortSignal;
}

export interface WebMcpTool {
  name: string;
  title: string;
  description: string;
  inputSchema?: JsonSchema;
  annotations?: WebMcpToolAnnotations;
  execute: (
    input: unknown,
    options: WebMcpToolExecutionOptions,
  ) => unknown | Promise<unknown>;
}

export interface WebMcpModelContext {
  registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ): Promise<void> | void;
}

declare global {
  interface Document {
    modelContext?: WebMcpModelContext;
  }

  interface Navigator {
    /** Compatibility surface used by older WebMCP implementations. */
    modelContext?: WebMcpModelContext;
  }
}

export function getWebMcpModelContext(): WebMcpModelContext | null {
  if (typeof document === "undefined") return null;
  return document.modelContext ?? navigator.modelContext ?? null;
}

export function signalFor(options?: Partial<WebMcpToolExecutionOptions>): AbortSignal {
  return options?.signal ?? new AbortController().signal;
}
