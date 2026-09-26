/**
 * Reads a fetch() response without assuming it is JSON. Our API always answers JSON, but the
 * hosting platform, a proxy or a crashed function can answer plain text or HTML instead — e.g.
 * Vercel's `413 Request Entity Too Large` — and calling `response.json()` on that throws
 * `Unexpected token 'R', "Request En"... is not valid JSON` at the user.
 */
export type ApiResult<T> = { ok: boolean; status: number; data: T | null; message: string | null };

export async function readApiResponse<T = unknown>(response: Response, fallback: string): Promise<ApiResult<T>> {
  const contentType = response.headers.get("content-type") ?? "";
  let data: T | null = null;
  let text = "";
  try {
    if (contentType.includes("json")) data = (await response.json()) as T;
    else text = await response.text();
  } catch {
    // A body that claims JSON but isn't (or can't be read) is treated like any other failure.
  }
  if (response.ok) return { ok: true, status: response.status, data, message: null };
  const serverMessage = (data as { error?: { message?: unknown } } | null)?.error?.message;
  return {
    ok: false,
    status: response.status,
    data,
    message: typeof serverMessage === "string" && serverMessage ? serverMessage : describeHttpFailure(response.status, text, fallback),
  };
}

/** A human message for a failure that came back without our JSON error envelope. */
export function describeHttpFailure(status: number, text: string, fallback: string) {
  if (status === 413 || /request entity too large|payload too large/i.test(text)) return "The file is too large to upload.";
  if (status === 401) return "Your session has expired. Sign in again and retry.";
  if (status === 403) return "You don't have permission to do this.";
  if (status === 429) return "Too many requests right now. Wait a moment and retry.";
  if (status === 408 || status === 504) return "The upload took too long. Check your connection and retry.";
  if (status >= 500) return `NesAfric couldn't process this right now (error ${status}). Please retry.`;
  return fallback;
}
