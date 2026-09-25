/**
 * Runtime configuration. `EXPO_PUBLIC_*` variables are inlined into the JavaScript bundle at build
 * time, so the API origin is fixed per build (development, preview, production).
 *
 * There is deliberately no default API URL: a build without `EXPO_PUBLIC_API_URL` shows a
 * configuration error instead of silently talking to an unverified or production backend.
 */
export type AppConfig = { apiUrl: string };

export class ConfigError extends Error {}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "10.0.2.2"]);

export function parseApiUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) {
    throw new ConfigError("EXPO_PUBLIC_API_URL is not set. Copy .env.example to .env and set the NesAfric API origin.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`EXPO_PUBLIC_API_URL is not a valid URL: ${value}`);
  }
  // Session tokens travel in the Authorization header, so plain HTTP is only acceptable for a
  // developer's own machine (10.0.2.2 is the host machine as seen from the Android emulator).
  const isLocal = LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith(".local");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new ConfigError("EXPO_PUBLIC_API_URL must use https:// (http:// is allowed only for localhost).");
  }
  return url.origin;
}

export function loadConfig(): AppConfig {
  return { apiUrl: parseApiUrl(process.env.EXPO_PUBLIC_API_URL) };
}
