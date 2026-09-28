import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * The signed-in session, kept in the platform keystore: iOS Keychain / Android Keystore-backed
 * storage via expo-secure-store, readable only on this device after first unlock. Never
 * AsyncStorage. The web preview build has no secure store, so there the session lives in memory
 * only (signed out on reload) rather than in localStorage.
 *
 * Signing out writes a non-secret "signed out" flag to AsyncStorage before deleting the credential.
 * While the flag is set the stored credential is never restored, so a failed secure-store deletion
 * can't quietly sign the person back in on the next launch; the deletion is retried at launch.
 */
/** `email` is null for a phone-only account; sessions saved before phone sign-in have no `phone`. */
export type StoredUser = { id: string; email: string | null; phone?: string | null; displayName: string };
export type StoredSession = { token: string; expiresAt: string; user: StoredUser };

const KEY = "nesafric.session.v1";
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
/** Non-secret "do not restore" flag. Holds only "1", never the token. */
export const SIGNED_OUT_FLAG = "nesafric.signed-out.v1";
/** Written over the credential when it can't be deleted; unparseable, so never restored. */
const TOMBSTONE = "signed-out";

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
      (typeof candidate.user.email === "string" || candidate.user.email === null) &&
      (candidate.user.phone === undefined || candidate.user.phone === null || typeof candidate.user.phone === "string") &&
      typeof candidate.user.displayName === "string",
  );
}

/**
 * The stored session if present, well-formed, unexpired and not signed out; anything else is
 * deleted. If the signed-out flag is set (or can't be read) nothing is restored and the deletion is
 * retried; the flag is cleared only once the credential is gone.
 */
export async function loadSession(now = Date.now()): Promise<StoredSession | null> {
  if (inMemoryOnly) return parseStored(memory, now);
  let signedOut: boolean;
  try {
    signedOut = (await AsyncStorage.getItem(SIGNED_OUT_FLAG)) !== null;
  } catch {
    return null; // fail closed: can't tell whether this device was signed out
  }
  if (signedOut) {
    await clearLocalSession();
    return null;
  }
  let raw: string | null;
  try {
    raw = await readRaw();
  } catch {
    return null;
  }
  const session = parseStored(raw, now);
  if (raw && !session) await clearLocalSession();
  return session;
}

function parseStored(raw: string | null, now: number): StoredSession | null {
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isStoredSession(parsed) && Date.parse(parsed.expiresAt) > now ? parsed : null;
}

/** Saves a new session and lifts any earlier signed-out flag (only after the save succeeded). */
export async function saveSession(session: StoredSession) {
  const raw = JSON.stringify(session);
  if (inMemoryOnly) {
    memory = raw;
    return;
  }
  await SecureStore.setItemAsync(KEY, raw, OPTIONS);
  // If this fails the next launch starts signed out, which is the safe direction.
  await AsyncStorage.removeItem(SIGNED_OUT_FLAG).catch(() => undefined);
}

/**
 * - `cleared`: the credential was deleted from secure storage.
 * - `pendingDeletion`: deletion failed, but the credential is overwritten and/or flagged, so it
 *   will not be restored; deletion is retried on the next launch.
 * - `failed`: nothing could be written; the credential may still be restored after a restart.
 */
export type LocalClearResult = "cleared" | "pendingDeletion" | "failed";

export async function clearLocalSession(): Promise<LocalClearResult> {
  if (inMemoryOnly) {
    memory = null;
    return "cleared";
  }
  // Flag first, so an interrupted sign-out (app killed, crash) still can't restore the credential.
  const flagged = await AsyncStorage.setItem(SIGNED_OUT_FLAG, "1").then(
    () => true,
    () => false,
  );
  try {
    await SecureStore.deleteItemAsync(KEY, OPTIONS);
  } catch {
    const overwritten = await SecureStore.setItemAsync(KEY, TOMBSTONE, OPTIONS).then(
      () => true,
      () => false,
    );
    return flagged || overwritten ? "pendingDeletion" : "failed";
  }
  if (flagged) await AsyncStorage.removeItem(SIGNED_OUT_FLAG).catch(() => undefined);
  return "cleared";
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
