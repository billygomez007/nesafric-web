import type { templateCreationPayload } from "./format";

/**
 * WhatsApp Business Management API: message templates on one WhatsApp Business Account. Uses the
 * same system-user token as sending (`WHATSAPP_PROVIDER_ACCESS_TOKEN`, which needs
 * `whatsapp_business_management`) and `WHATSAPP_GRAPH_API_VERSION`. The token is only ever sent
 * to graph.facebook.com and never logged.
 */
export type MetaTemplate = {
  id: string; name: string; language: string; status: string; category: string; rejected_reason?: string; quality_score?: { score?: string };
  components?: Array<{ type?: string; text?: string; buttons?: Array<{ type?: string; text?: string }> }>;
};
type Fetch = typeof fetch;

export class MetaTemplateApiError extends Error {
  constructor(readonly status: number, readonly metaCode: number | null, message: string) { super(message); }
}

function settings(env: Record<string, string | undefined>) {
  const version = env.WHATSAPP_GRAPH_API_VERSION?.trim();
  const token = env.WHATSAPP_PROVIDER_ACCESS_TOKEN?.trim();
  if (!version || !/^v\d+\.\d+$/.test(version)) throw new Error("WHATSAPP_GRAPH_API_VERSION is not set (for example v21.0).");
  if (!token) throw new Error("WHATSAPP_PROVIDER_ACCESS_TOKEN is not set.");
  return { base: `https://graph.facebook.com/${version}`, token };
}

async function call(fetchImpl: Fetch, url: string, token: string, init: { method: "GET" | "POST"; body?: unknown }) {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.hostname !== "graph.facebook.com") throw new Error("Template API calls only go to https://graph.facebook.com.");
  const response = await fetchImpl(target, {
    method: init.method,
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as { error?: { message?: string; code?: number; error_user_msg?: string } } & Record<string, unknown>;
  if (!response.ok) {
    const detail = payload.error?.error_user_msg ?? payload.error?.message ?? "no detail";
    throw new MetaTemplateApiError(response.status, payload.error?.code ?? null, `Meta template API responded ${response.status}: ${detail.slice(0, 300)}`);
  }
  return payload;
}

export function metaTemplateClient(env: Record<string, string | undefined> = process.env, fetchImpl: Fetch = fetch) {
  return {
    /** Every template on the WABA, following Meta's paging (bounded). */
    async list(wabaId: string): Promise<MetaTemplate[]> {
      if (!/^\d{1,32}$/.test(wabaId)) throw new Error("Invalid WhatsApp Business Account ID.");
      const { base, token } = settings(env);
      const templates: MetaTemplate[] = [];
      let next: string | undefined = `${base}/${wabaId}/message_templates?fields=id,name,language,status,category,rejected_reason,quality_score,components&limit=100`;
      for (let page = 0; next && page < 50; page += 1) {
        const payload = await call(fetchImpl, next, token, { method: "GET" }) as { data?: MetaTemplate[]; paging?: { next?: string } };
        templates.push(...(payload.data ?? []));
        next = payload.paging?.next;
      }
      return templates;
    },
    /** Creates one template. Meta answers with its id, initial status and the category it assigned. */
    async create(wabaId: string, payload: ReturnType<typeof templateCreationPayload>) {
      if (!/^\d{1,32}$/.test(wabaId)) throw new Error("Invalid WhatsApp Business Account ID.");
      const { base, token } = settings(env);
      const result = await call(fetchImpl, `${base}/${wabaId}/message_templates`, token, { method: "POST", body: payload }) as { id?: string; status?: string; category?: string };
      if (!result.id) throw new MetaTemplateApiError(200, null, "Meta accepted the template but returned no id.");
      return { id: result.id, status: result.status ?? "PENDING", category: result.category ?? payload.category };
    },
  };
}
export type MetaTemplateClient = ReturnType<typeof metaTemplateClient>;
