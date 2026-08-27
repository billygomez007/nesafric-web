import { AppError } from "@/platform/errors";

/**
 * Provider-neutral speech interfaces (Phase 22B item 2). Mirrors `VoiceProviderAdapter`'s shape
 * exactly (registry, `isConfigured()` gate, deterministic mock, real adapter behind credentials)
 * but for STT/TTS specifically — telephony transport, speech-to-text, and text-to-speech are three
 * independently swappable provider concerns, never bundled into one vendor lock-in.
 *
 * No real audio pipeline exists in this environment (no microphone/speaker, no way to synthesize
 * or decode actual audio bytes in a server-side test). Every adapter here therefore operates on
 * *text* at its boundary — a real STT adapter would decode base64/binary audio frames internally
 * and emit the same `{ text, isFinal, confidence }` shape this interface already defines; the mock
 * adapter is simply handed the already-known text directly (via `simulatedText`), which is exactly
 * how `tests/postgres-phase22b-*.test.ts` drives the realtime pipeline without needing real audio.
 */
export type TranscribeInput = {
  /** Real adapters: a base64-encoded audio chunk. Mock/test transport: the already-known text this
   * chunk represents — there is no real audio codec in this environment to decode. */
  audioChunkBase64?: string;
  simulatedText?: string;
  language: string;
  isFinalChunk: boolean;
};

export type TranscribeResult = { text: string; isFinal: boolean; confidence: number };

export interface SpeechToTextAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly supportedLanguages: readonly string[];
  isConfigured(): boolean;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

export type SynthesizeInput = { text: string; language: string; voiceProfileId?: string };
export type SynthesizeResult = { audioRef: string; characterCount: number };

export interface TextToSpeechAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly supportedLanguages: readonly string[];
  isConfigured(): boolean;
  synthesize(input: SynthesizeInput): Promise<SynthesizeResult>;
}

function env(name: string) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/** Deterministic, credential-free STT transport (item 1's "no production credentials → mock
 * transport" convention, applied to speech). Only genuinely "delivers" English — declaring a
 * broader `supportedLanguages` list here would violate item 11's "do not claim language support
 * that the configured provider cannot actually deliver," since this adapter has no real language
 * model at all, only text passthrough. */
export class MockSpeechToTextAdapter implements SpeechToTextAdapter {
  readonly key = "MOCK";
  readonly displayName = "Deterministic test transcription";
  readonly supportedLanguages = ["en"] as const;

  isConfigured() {
    return true;
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    // Deterministic failure trigger (item 16/17's "STT outage" test) — mirrors the `+000`
    // telephony-outage and `_unreachable` call-control conventions already used elsewhere in this
    // module family, so a test can simulate a real STT-provider failure without any real
    // credentials or network access.
    if (input.simulatedText === "__STT_FAIL__") throw new AppError("VOICE_SPEECH_PROVIDER_ERROR", 502, "Simulated STT provider outage (deterministic '__STT_FAIL__' test trigger).");
    return { text: input.simulatedText ?? "", isFinal: input.isFinalChunk, confidence: input.simulatedText ? 1 : 0 };
  }
}

export class MockTextToSpeechAdapter implements TextToSpeechAdapter {
  readonly key = "MOCK";
  readonly displayName = "Deterministic test synthesis";
  readonly supportedLanguages = ["en"] as const;

  isConfigured() {
    return true;
  }

  async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
    // Deterministic failure trigger (item 16/17's "TTS outage" test) — a persona's
    // `voiceProfileId` is the only per-call-controllable input reaching this adapter.
    if (input.voiceProfileId === "__TTS_FAIL__") throw new AppError("VOICE_SPEECH_PROVIDER_ERROR", 502, "Simulated TTS provider outage (deterministic '__TTS_FAIL__' test trigger).");
    return { audioRef: `mock-audio://${Buffer.from(input.text).toString("base64url").slice(0, 40)}`, characterCount: input.text.length };
  }
}

/**
 * Real STT adapter stub (item 1/11) — a Deepgram-shaped REST integration, gated entirely behind
 * `STT_PROVIDER_API_KEY`. Never invoked without credentials (`isConfigured()` false), and its
 * language list is honest about what Deepgram's real English + West-African-relevant models
 * actually support today — English fully, a handful of others at lower confidence — rather than
 * claiming full parity across every language NesAfric might eventually operate in.
 */
export class DeepgramSpeechToTextAdapter implements SpeechToTextAdapter {
  readonly key = "DEEPGRAM";
  readonly displayName = "Deepgram";
  readonly supportedLanguages = ["en", "fr"] as const;

  isConfigured() {
    return Boolean(env("STT_PROVIDER_API_KEY"));
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const apiKey = env("STT_PROVIDER_API_KEY");
    if (!apiKey) throw new AppError("VOICE_SPEECH_PROVIDER_NOT_CONFIGURED", 422, "Deepgram credentials (STT_PROVIDER_API_KEY) are not configured.");
    const response = await fetch(`https://api.deepgram.com/v1/listen?language=${encodeURIComponent(input.language)}&punctuate=true`, {
      method: "POST",
      headers: { authorization: `Token ${apiKey}`, "content-type": "audio/webm" },
      body: input.audioChunkBase64 ? Buffer.from(input.audioChunkBase64, "base64") : undefined,
    });
    if (!response.ok) throw new AppError("VOICE_SPEECH_PROVIDER_ERROR", 502, `Deepgram returned HTTP ${response.status}.`);
    const payload = (await response.json()) as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string; confidence?: number }> }> } };
    const alternative = payload.results?.channels?.[0]?.alternatives?.[0];
    return { text: alternative?.transcript ?? "", isFinal: input.isFinalChunk, confidence: alternative?.confidence ?? 0 };
  }
}

/** Real TTS adapter stub (item 1/11), ElevenLabs-shaped, gated behind `TTS_PROVIDER_API_KEY`. */
export class ElevenLabsTextToSpeechAdapter implements TextToSpeechAdapter {
  readonly key = "ELEVENLABS";
  readonly displayName = "ElevenLabs";
  readonly supportedLanguages = ["en", "fr"] as const;

  isConfigured() {
    return Boolean(env("TTS_PROVIDER_API_KEY"));
  }

  async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
    const apiKey = env("TTS_PROVIDER_API_KEY");
    if (!apiKey) throw new AppError("VOICE_SPEECH_PROVIDER_NOT_CONFIGURED", 422, "ElevenLabs credentials (TTS_PROVIDER_API_KEY) are not configured.");
    const voiceId = input.voiceProfileId ?? env("TTS_DEFAULT_VOICE_ID") ?? "default";
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ text: input.text, model_id: "eleven_multilingual_v2" }),
    });
    if (!response.ok) throw new AppError("VOICE_SPEECH_PROVIDER_ERROR", 502, `ElevenLabs returned HTTP ${response.status}.`);
    const audio = Buffer.from(await response.arrayBuffer());
    return { audioRef: `data:audio/mpeg;base64,${audio.toString("base64").slice(0, 64)}...`, characterCount: input.text.length };
  }
}

class SpeechRegistry<T extends { key: string }> {
  private readonly adapters = new Map<string, T>();
  constructor(adapters: T[]) {
    for (const adapter of adapters) this.adapters.set(adapter.key, adapter);
  }
  get(key: string) {
    const adapter = this.adapters.get(key);
    if (!adapter) throw new AppError("VOICE_SPEECH_PROVIDER_UNKNOWN", 404, `Speech provider '${key}' is not registered.`);
    return adapter;
  }
  list() {
    return [...this.adapters.values()];
  }
}

export const speechToTextProviders = new SpeechRegistry<SpeechToTextAdapter>([new MockSpeechToTextAdapter(), new DeepgramSpeechToTextAdapter()]);
export const textToSpeechProviders = new SpeechRegistry<TextToSpeechAdapter>([new MockTextToSpeechAdapter(), new ElevenLabsTextToSpeechAdapter()]);

/** Resolves the STT adapter that should actually be used for a given organisation's configured
 * `sttProviderKey`, falling back to `MOCK` whenever the configured one is not actually configured
 * with real credentials — never silently invents credentials, never crashes a call because an
 * operator selected a provider before supplying its API key. */
export function resolveSTTAdapter(sttProviderKey: string): SpeechToTextAdapter {
  const adapter = speechToTextProviders.get(sttProviderKey);
  return adapter.isConfigured() ? adapter : speechToTextProviders.get("MOCK");
}

export function resolveTTSAdapter(ttsProviderKey: string): TextToSpeechAdapter {
  const adapter = textToSpeechProviders.get(ttsProviderKey);
  return adapter.isConfigured() ? adapter : textToSpeechProviders.get("MOCK");
}

/** Item 11: "do not claim language support that the configured providers cannot actually
 * deliver." Used when writing a `VoicePersonaConfig` to reject a `supportedLanguages` entry
 * neither the organisation's configured STT nor TTS adapter can actually handle. */
export function isLanguageDeliverable(sttProviderKey: string, ttsProviderKey: string, language: string) {
  return resolveSTTAdapter(sttProviderKey).supportedLanguages.includes(language) && resolveTTSAdapter(ttsProviderKey).supportedLanguages.includes(language);
}
