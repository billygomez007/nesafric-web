export type AIToolDefinition = {
  key: string;
  description?: string;
  parameters?: Record<string, unknown>;
  kind?: "read" | "action";
};

export type AIProviderRequest = {
  message: string;
  allowedTools: readonly string[];
  toolDefinitions?: readonly AIToolDefinition[];
  systemPrompt?: string;
};

export type AIProviderUsage = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  providerRequestId?: string;
  providerMessageId?: string;
  estimatedCostNanoUnits?: number;
  latencyMs?: number;
  attempts?: number;
};

export type AIProviderResponse = {
  text: string;
  toolKey?: string;
  toolCall?: { key: string; arguments: Record<string, unknown>; id?: string };
  inputTokens: number;
  outputTokens: number;
  modelKey: string;
  usage?: AIProviderUsage;
};

export interface AIProvider {
  readonly key: string;
  complete(request: AIProviderRequest): Promise<AIProviderResponse>;
}

export type AIProviderErrorCode =
  | "AUTHENTICATION"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK"
  | "UPSTREAM"
  | "MALFORMED_RESPONSE"
  | "UNKNOWN_TOOL";

export class AIProviderError extends Error {
  readonly name = "AIProviderError";

  constructor(
    readonly code: AIProviderErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly providerRequestId?: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

export type AIProviderTransport = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json" | "text" | "headers">>;

export type OpenAICompatibleProviderConfig = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  inputCostPerMillionNanoUnits?: number;
  outputCostPerMillionNanoUnits?: number;
};

type OpenAIResponse = {
  id?: unknown;
  model?: unknown;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  choices?: Array<{
    message?: {
      id?: unknown;
      content?: unknown;
      tool_calls?: unknown;
    };
  }>;
};

const estimateTokens = (value: string) => Math.max(1, Math.ceil(value.length / 4));
const defaultParameters = { type: "object", properties: {}, additionalProperties: false };
const readToolDescriptions: Record<string, string> = {
  "portfolio.summary": "Read a high-level portfolio summary.",
  "rent.overdue_summary": "Read an aggregate summary of overdue rent.",
  "leases.expiring_summary": "Read leases expiring in the next 90 days.",
  "maintenance.open_summary": "Read an aggregate summary of open maintenance.",
  "operations.attention": "Read operational items that need attention.",
  "operations.daily_brief": "Read the daily operational brief.",
  "maintenance.create": "Prepare a maintenance creation action for human review and approval.",
};

const externalToolName = (key: string) => `propertyos_${key.replace(/[^a-zA-Z0-9_-]/g, "__")}`;
const finiteNonNegativeInteger = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;

function parseNumber(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const nonEmpty = (value: string | undefined) => value?.trim() || undefined;

function errorForStatus(status: number, message: string, requestId?: string) {
  if (status === 401 || status === 403) {
    return new AIProviderError("AUTHENTICATION", message, false, status, requestId);
  }
  if (status === 400 || status === 404 || status === 405 || status === 422) {
    return new AIProviderError("VALIDATION", message, false, status, requestId);
  }
  if (status === 429) return new AIProviderError("RATE_LIMITED", message, true, status, requestId);
  const retryable = status === 408 || status === 409 || status === 425 || status >= 500;
  return new AIProviderError("UPSTREAM", message, retryable, status, requestId);
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export class OpenAICompatibleAIProvider implements AIProvider {
  readonly key = "openai-compatible";
  private readonly config: Required<Omit<OpenAICompatibleProviderConfig,
    "inputCostPerMillionNanoUnits" | "outputCostPerMillionNanoUnits">>
    & Pick<OpenAICompatibleProviderConfig, "inputCostPerMillionNanoUnits" | "outputCostPerMillionNanoUnits">;

  constructor(
    config: OpenAICompatibleProviderConfig,
    private readonly transport: AIProviderTransport = (input, init) => fetch(input, init),
    private readonly sleep: (milliseconds: number) => Promise<void> =
      (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl ?? "https://api.openai.com/v1",
      timeoutMs: Math.max(1, config.timeoutMs ?? 30_000),
      maxRetries: Math.min(5, Math.max(0, Math.floor(config.maxRetries ?? 2))),
      retryDelayMs: Math.max(0, config.retryDelayMs ?? 250),
      inputCostPerMillionNanoUnits: config.inputCostPerMillionNanoUnits,
      outputCostPerMillionNanoUnits: config.outputCostPerMillionNanoUnits,
    };
  }

  async complete(request: AIProviderRequest): Promise<AIProviderResponse> {
    const startedAt = Date.now();
    const definitions = new Map(
      (request.toolDefinitions ?? []).map((definition) => [definition.key, definition]),
    );
    const tools = request.allowedTools.map((key) => {
      const definition = definitions.get(key);
      const parameters = definition?.parameters ?? defaultParameters;
      const properties = asObject(parameters.properties) ?? {};
      return {
        type: "function",
        function: {
          name: externalToolName(key),
          description: definition?.description ?? readToolDescriptions[key] ?? `Use the ${key} capability.`,
          parameters,
          // Server-side Zod validation remains authoritative for optional action fields.
          strict: Object.keys(properties).length === 0,
        },
      };
    });
    const body = JSON.stringify({
      model: this.config.model,
      messages: [
        {
          role: "system",
          content: request.systemPrompt
            ?? "You are a property operations assistant. Use only the supplied tools. Never invent a tool or claim an action was executed.",
        },
        { role: "user", content: request.message },
      ],
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
    });

    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await this.requestOnce(body, request);
        if (result.usage) {
          result.usage.latencyMs = Date.now() - startedAt;
          result.usage.attempts = attempt + 1;
        }
        return result;
      } catch (error) {
        const normalized = error instanceof AIProviderError
          ? error
          : new AIProviderError("NETWORK", "The AI provider could not be reached.", true, undefined, undefined, error);
        if (!normalized.retryable || attempt >= this.config.maxRetries) throw normalized;
        await this.sleep(this.config.retryDelayMs * (2 ** attempt));
      }
    }
  }

  private async requestOnce(body: string, request: AIProviderRequest): Promise<AIProviderResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Awaited<ReturnType<AIProviderTransport>>;
    try {
      response = await this.transport(`${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
        },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AIProviderError("TIMEOUT", "The AI provider request timed out.", true, undefined, undefined, error);
      }
      throw new AIProviderError("NETWORK", "The AI provider could not be reached.", true, undefined, undefined, error);
    } finally {
      clearTimeout(timeout);
    }

    const headerRequestId = response.headers.get("x-request-id") ?? undefined;
    if (!response.ok) {
      let detail = `The AI provider returned HTTP ${response.status}.`;
      try {
        const payload = asObject(await response.json());
        const providerError = asObject(payload?.error);
        if (typeof providerError?.message === "string") detail = providerError.message;
      } catch {
        // The status is sufficient when an upstream error body is not JSON.
      }
      throw errorForStatus(response.status, detail, headerRequestId);
    }

    let payload: OpenAIResponse;
    try {
      payload = await response.json() as OpenAIResponse;
    } catch (error) {
      throw new AIProviderError("MALFORMED_RESPONSE", "The AI provider returned invalid JSON.", false, response.status, headerRequestId, error);
    }
    const message = payload.choices?.[0]?.message;
    if (!message) {
      throw new AIProviderError("MALFORMED_RESPONSE", "The AI provider response did not contain a message.", false, response.status, headerRequestId);
    }

    let toolCall: AIProviderResponse["toolCall"];
    if (message.tool_calls !== undefined) {
      if (!Array.isArray(message.tool_calls) || message.tool_calls.length !== 1) {
        throw new AIProviderError("MALFORMED_RESPONSE", "The AI provider must return exactly one structured tool call.", false, response.status, headerRequestId);
      }
      const rawCall = asObject(message.tool_calls[0]);
      const fn = asObject(rawCall?.function);
      if (typeof fn?.name !== "string" || typeof fn.arguments !== "string") {
        throw new AIProviderError("MALFORMED_RESPONSE", "The AI provider returned a malformed tool call.", false, response.status, headerRequestId);
      }
      const key = request.allowedTools.find((allowed) =>
        fn.name === externalToolName(allowed) || fn.name === allowed);
      if (!key) {
        throw new AIProviderError("UNKNOWN_TOOL", "The AI provider requested a tool that was not allowed.", false, response.status, headerRequestId);
      }
      let args: Record<string, unknown> | undefined;
      try {
        args = asObject(JSON.parse(fn.arguments));
      } catch {
        // Report a single normalized malformed-response error below.
      }
      if (!args) {
        throw new AIProviderError("MALFORMED_RESPONSE", "The AI provider returned malformed tool arguments.", false, response.status, headerRequestId);
      }
      toolCall = { key, arguments: args, ...(typeof rawCall?.id === "string" ? { id: rawCall.id } : {}) };
    }

    const text = typeof message.content === "string" ? message.content : "";
    if (!text && !toolCall) {
      throw new AIProviderError("MALFORMED_RESPONSE", "The AI provider response was empty.", false, response.status, headerRequestId);
    }
    const inputTokens = finiteNonNegativeInteger(payload.usage?.prompt_tokens) ?? estimateTokens(request.message);
    const outputTokens = finiteNonNegativeInteger(payload.usage?.completion_tokens)
      ?? estimateTokens(text || JSON.stringify(toolCall));
    const model = typeof payload.model === "string" ? payload.model : this.config.model;
    const providerRequestId = typeof payload.id === "string" ? payload.id : headerRequestId;
    const providerMessageId = typeof message.id === "string" ? message.id : toolCall?.id;
    const inputCost = this.config.inputCostPerMillionNanoUnits;
    const outputCost = this.config.outputCostPerMillionNanoUnits;
    const estimatedCostNanoUnits = inputCost === undefined && outputCost === undefined
      ? undefined
      : Math.round((inputTokens * (inputCost ?? 0) + outputTokens * (outputCost ?? 0)) / 1_000_000);
    const usage: AIProviderUsage = {
      provider: this.key,
      model,
      inputTokens,
      outputTokens,
      ...(providerRequestId ? { providerRequestId } : {}),
      ...(providerMessageId ? { providerMessageId } : {}),
      ...(estimatedCostNanoUnits !== undefined ? { estimatedCostNanoUnits } : {}),
    };
    return {
      text,
      ...(toolCall ? { toolKey: toolCall.key, toolCall } : {}),
      inputTokens,
      outputTokens,
      modelKey: model,
      usage,
    };
  }
}

export class DeterministicAIProvider implements AIProvider {
  readonly key = "deterministic";

  async complete({ message, allowedTools }: AIProviderRequest): Promise<AIProviderResponse> {
    const normalized = message.toLowerCase();
    const requestedTool =
      normalized.includes("daily brief") ? "operations.daily_brief" :
      normalized.includes("attention") || normalized.includes("needs action") ? "operations.attention" :
      normalized.includes("vacant") || normalized.includes("vacancy") ? "vacancy.summary" :
      normalized.includes("owe rent") || normalized.includes("overdue") ? "rent.overdue_summary" :
      normalized.includes("rent collection") ? "rent.collection_summary" :
      normalized.includes("expir") || normalized.includes("renew") ? "leases.expiring_summary" :
      normalized.includes("work order") || normalized.includes("stuck") ? "maintenance.work_orders" :
      normalized.includes("quotation") ? "providers.quotations" :
      normalized.includes("provider assignment") || normalized.includes("artisan") ? "providers.assignments" :
      normalized.includes("lead") ? "leads.stale" :
      normalized.includes("application") ? "applications.summary" :
      normalized.includes("viewing") ? "viewings.upcoming" :
      normalized.includes("move-in") || normalized.includes("move in") ? "move_ins.summary" :
      normalized.includes("move-out") || normalized.includes("move out") ? "move_outs.summary" :
      normalized.includes("deposit settlement") ? "deposits.settlements" :
      normalized.includes("failed notification") ? "notifications.failed" :
      normalized.includes("failed job") ? "jobs.failed" :
      normalized.includes("listing") ? "listings.summary" :
      normalized.includes("maintenance") ? "maintenance.open_summary" :
      normalized.includes("property") || normalized.includes("unit status") ? "assets.status" :
      normalized.includes("performance") || normalized.includes("this week") ? "portfolio.performance" :
      normalized.includes("portfolio") || normalized.includes("command center") || normalized.includes("overview") ? "portfolio.summary" :
      undefined;
    const toolKey = requestedTool && allowedTools.includes(requestedTool) ? requestedTool : undefined;
    const text = toolKey
      ? "I used an organisation-scoped operational tool to answer this request."
      : "I can provide deterministic operational summaries. I cannot execute sensitive actions from conversation text. Approval-required actions need a configured external provider or a structured proposal submitted through the API; no action was executed.";
    const inputTokens = estimateTokens(message);
    const outputTokens = estimateTokens(text);
    return {
      text,
      ...(toolKey ? { toolKey, toolCall: { key: toolKey, arguments: {} } } : {}),
      inputTokens,
      outputTokens,
      modelKey: "propertyos-deterministic-v1",
      usage: {
        provider: this.key,
        model: "propertyos-deterministic-v1",
        inputTokens,
        outputTokens,
        estimatedCostNanoUnits: 0,
      },
    };
  }
}

export class UnavailableAIProvider implements AIProvider {
  readonly key = "unavailable";

  async complete(): Promise<AIProviderResponse> {
    throw new AIProviderError("UPSTREAM", "The configured AI provider is unavailable.", true);
  }
}

function externalConfigFromEnvironment(): OpenAICompatibleProviderConfig | undefined {
  const apiKey = nonEmpty(process.env.AI_PROVIDER_API_KEY) ?? nonEmpty(process.env.OPENAI_API_KEY);
  if (!apiKey) return undefined;
  const inputCost = nonEmpty(process.env.AI_PROVIDER_INPUT_COST_PER_MILLION_NANO_UNITS);
  const outputCost = nonEmpty(process.env.AI_PROVIDER_OUTPUT_COST_PER_MILLION_NANO_UNITS);
  return {
    apiKey,
    model: nonEmpty(process.env.AI_PROVIDER_MODEL) ?? nonEmpty(process.env.OPENAI_MODEL) ?? "gpt-4o-mini",
    baseUrl: nonEmpty(process.env.AI_PROVIDER_BASE_URL) ?? nonEmpty(process.env.OPENAI_BASE_URL),
    timeoutMs: parseNumber(process.env.AI_PROVIDER_TIMEOUT_MS, 30_000),
    maxRetries: parseNumber(process.env.AI_PROVIDER_MAX_RETRIES, 2),
    retryDelayMs: parseNumber(process.env.AI_PROVIDER_RETRY_DELAY_MS, 250),
    inputCostPerMillionNanoUnits: inputCost === undefined ? undefined : parseNumber(inputCost, 0),
    outputCostPerMillionNanoUnits: outputCost === undefined ? undefined : parseNumber(outputCost, 0),
  };
}

export function getAIProvider(): AIProvider {
  const selected = process.env.AI_PROVIDER?.toLowerCase();
  if (selected === "unavailable") return new UnavailableAIProvider();
  if (selected === "openai" || selected === "openai-compatible" || selected === "external") {
    const config = externalConfigFromEnvironment();
    if (config) return new OpenAICompatibleAIProvider(config);
  }
  return new DeterministicAIProvider();
}
