import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * The signed-in session, kept in the platform keystore: iOS Keychain / Android Keystore-backed
 * storage via expo-secure-store, readable only on this device after first unlock. Never
 * AsyncStorage. The web preview build has no secure store, so there the session lives in memory
 * only (signed out on reload) rather than in localStorage.
 */
export type StoredUser = { id: string; email: string; displayName: string };
export type StoredSession = { token: string; expiresAt: string; user: StoredUser };

const KEY = "nesafric.session.v1";
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

let memory: string | null = null;
const inMemoryOnly = Platform.OS === "web";

async function readRaw() {
  return inMemoryOnly ? memory : SecureStore.getItemAsync(KEY, OPTIONS);
}

export function isStoredSession(value: unknown): value is StoredSession {
  const candidate = value as StoredSession | null;
  return Boolean(
    candidate &&
      typeof candidate.token === "string" &&
      typeof candidate.expiresAt === "string" &&
      typeof candidate.user?.id === "string" &&
      typeof candidate.user.email === "string" &&
      typeof candidate.user.displayName === "string",
  );
}

/** The stored session if present, well-formed and unexpired; anything else is deleted. */
export async function loadSession(now = Date.now()): Promise<StoredSession | null> {
  let raw: string | null;
  try {
    raw = await readRaw();
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // fall through to clearing
  }
  if (!isStoredSession(parsed) || !(Date.parse(parsed.expiresAt) > now)) {
    await clearSession();
    return null;
  }
  return parsed;
}

export async function saveSession(session: StoredSession) {
  const raw = JSON.stringify(session);
  if (inMemoryOnly) memory = raw;
  else await SecureStore.setItemAsync(KEY, raw, OPTIONS);
}

export async function clearSession() {
  if (inMemoryOnly) memory = null;
  else await SecureStore.deleteItemAsync(KEY, OPTIONS).catch(() => undefined);
}

/*
 * In-memory copy of the current token for the API client, outside React (set from event handlers
 * and effects only). The durable copy is the secure-store entry above.
 */
let activeToken: string | null = null;
let sessionLostHandler: (() => void) | null = null;

export const getActiveToken = () => activeToken;

export function setActiveToken(token: string | null) {
  activeToken = token;
}

/** Registered by the session provider; called when an authenticated request gets 401. */
export function setSessionLostHandler(handler: (() => void) | null) {
  sessionLostHandler = handler;
}

export function reportSessionLost() {
  if (activeToken) sessionLostHandler?.();
}
