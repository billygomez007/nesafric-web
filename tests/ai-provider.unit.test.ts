import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AIProviderError,
  DeterministicAIProvider,
  getAIProvider,
  OpenAICompatibleAIProvider,
  type AIProviderTransport,
} from "@/modules/ai/providers";

const headers = new Headers({ "x-request-id": "req-header" });
const response = (status: number, payload: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  headers,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});

const provider = (transport: AIProviderTransport, overrides = {}) =>
  new OpenAICompatibleAIProvider({
    apiKey: "test-key",
    model: "test-model",
    timeoutMs: 20,
    maxRetries: 0,
    retryDelayMs: 0,
    inputCostPerMillionNanoUnits: 1_000_000,
    outputCostPerMillionNanoUnits: 2_000_000,
    ...overrides,
  }, transport, async () => undefined);

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AI_PROVIDER;
  delete process.env.AI_PROVIDER_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

describe("OpenAI-compatible AI provider", () => {
  it("sends definitions and parses a structured allowed tool call and usage", async () => {
    const transport = vi.fn<AIProviderTransport>().mockResolvedValue(response(200, {
      id: "completion-1",
      model: "remote-model",
      usage: { prompt_tokens: 10, completion_tokens: 4 },
      choices: [{
        message: {
          id: "message-1",
          content: null,
          tool_calls: [{
            id: "call-1",
            function: { name: "propertyos_portfolio__summary", arguments: "{}" },
          }],
        },
      }],
    }));
    const result = await provider(transport).complete({
      message: "Show my portfolio",
      allowedTools: ["portfolio.summary"],
      toolDefinitions: [{
        key: "portfolio.summary",
        description: "Portfolio totals",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      }],
    });

    expect(result).toMatchObject({
      toolKey: "portfolio.summary",
      toolCall: { key: "portfolio.summary", arguments: {}, id: "call-1" },
      inputTokens: 10,
      outputTokens: 4,
      modelKey: "remote-model",
      usage: {
        provider: "openai-compatible",
        providerRequestId: "completion-1",
        providerMessageId: "message-1",
        estimatedCostNanoUnits: 18,
      },
    });

    const sent = JSON.parse(String(transport.mock.calls[0]?.[1].body));
    expect(sent.tools[0].function).toMatchObject({
      name: "propertyos_portfolio__summary",
      description: "Portfolio totals",
      strict: true,
    });
  });

  it("uses non-strict provider schemas for optional action fields while retaining server validation", async () => {
    const transport = vi.fn<AIProviderTransport>().mockResolvedValue(response(200, {
      choices: [{ message: { content: "Proposal prepared." } }],
    }));
    await provider(transport).complete({
      message: "Prepare maintenance",
      allowedTools: ["maintenance.create"],
      toolDefinitions: [{
        key: "maintenance.create",
        kind: "action",
        parameters: {
          type: "object",
          properties: { propertyId: { type: "string" }, unitId: { type: "string" } },
          required: ["propertyId"],
          additionalProperties: false,
        },
      }],
    });
    const sent = JSON.parse(String(transport.mock.calls[0]?.[1].body));
    expect(sent.tools[0].function.strict).toBe(false);
  });

  it("rejects malformed and unknown tool calls", async () => {
    const malformed = provider(async () => response(200, {
      choices: [{ message: { content: null, tool_calls: [{ function: { name: "portfolio.summary", arguments: "{" } }] } }],
    }));
    await expect(malformed.complete({ message: "x", allowedTools: ["portfolio.summary"] }))
      .rejects.toMatchObject({ code: "MALFORMED_RESPONSE", retryable: false });

    const unknown = provider(async () => response(200, {
      choices: [{ message: { content: null, tool_calls: [{ function: { name: "admin_delete", arguments: "{}" } }] } }],
    }));
    await expect(unknown.complete({ message: "x", allowedTools: ["portfolio.summary"] }))
      .rejects.toMatchObject({ code: "UNKNOWN_TOOL", retryable: false });
  });

  it("retries retryable HTTP and network failures within the configured bound", async () => {
    const transport = vi.fn<AIProviderTransport>()
      .mockResolvedValueOnce(response(503, { error: { message: "busy" } }))
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockResolvedValueOnce(response(200, { choices: [{ message: { content: "Ready" } }] }));
    const result = await provider(transport, { maxRetries: 2 }).complete({ message: "hello", allowedTools: [] });
    expect(result.text).toBe("Ready");
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("aborts timed-out requests and returns a normalized timeout", async () => {
    const transport: AIProviderTransport = (_input, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")), { once: true });
    });
    await expect(provider(transport, { timeoutMs: 5 }).complete({ message: "hello", allowedTools: [] }))
      .rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("does not retry authentication or validation errors", async () => {
    const transport = vi.fn<AIProviderTransport>()
      .mockResolvedValue(response(401, { error: { message: "bad key" } }));
    const attempt = provider(transport, { maxRetries: 3 }).complete({ message: "hello", allowedTools: [] });
    await expect(attempt).rejects.toEqual(expect.objectContaining<Partial<AIProviderError>>({
      code: "AUTHENTICATION",
      retryable: false,
      status: 401,
    }));
    expect(transport).toHaveBeenCalledOnce();
  });
});

describe("provider selection and deterministic safety", () => {
  it("works credential-free and only selects external when explicitly configured with credentials", () => {
    expect(getAIProvider()).toBeInstanceOf(DeterministicAIProvider);
    process.env.AI_PROVIDER = "openai-compatible";
    expect(getAIProvider()).toBeInstanceOf(DeterministicAIProvider);
    process.env.AI_PROVIDER_API_KEY = "configured-at-runtime";
    expect(getAIProvider()).toBeInstanceOf(OpenAICompatibleAIProvider);
  });

  it("recognizes read intents but does not fabricate action arguments", async () => {
    const deterministic = new DeterministicAIProvider();
    const action = await deterministic.complete({
      message: "Create a maintenance report",
      allowedTools: ["maintenance.create"],
    });
    expect(action.toolCall).toBeUndefined();
    expect(action.text).toContain("no action was executed");
    const prohibited = await deterministic.complete({
      message: "Reverse a payment and change permissions",
      allowedTools: ["payment.reverse", "security.permission.change"],
    });
    expect(prohibited.toolKey).toBeUndefined();
  });
});
