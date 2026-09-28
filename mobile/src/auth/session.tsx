import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { createMobileSession, revokeSession, verifyOtpForSession, type MobileSessionResponse, type OtpVerifyInput } from "@/api/account";
import { ApiError, createApiClient, type ApiClient } from "@/api/client";
import {
  clearLocalSession,
  getActiveToken,
  loadSession,
  reportSessionLost,
  saveSession,
  setActiveToken,
  setSessionLostHandler,
  type LocalClearResult,
  type StoredUser,
} from "./token-store";
import { completeGoogleRedirect as completeGoogle, signInWithGoogle as runGoogleSignIn } from "./google";
import { clearLastWorkspaces } from "./workspaces";

/**
 * Optional sign-in. The marketplace never waits for or depends on this: guests browse, save and
 * enquire exactly as before. Account data lives under the `["account"]` query key and is cancelled
 * and removed on sign-out or session loss; marketplace data and device-saved properties are left
 * alone.
 *
 * Sign-out is local first: the token stops being used the moment the person taps Sign out. Server
 * revocation is then attempted in the background, and the notice says honestly whether it happened.
 */
export type SessionStatus = "restoring" | "signedOut" | "signedIn";

/** `ended`: the server answered and no session row remains for the token. `notConfirmed`: it couldn't be reached or failed. */
export type ServerSignOut = "pending" | "ended" | "notConfirmed";

export type SessionNotice =
  | { kind: "expired"; device: LocalClearResult }
  | { kind: "signedOut"; server: ServerSignOut; device: LocalClearResult; expiresAt: string | null }
  | null;

type SessionContextValue = {
  status: SessionStatus;
  user: StoredUser | null;
  /** Outcome of the last sign-out or session loss (shown on the Account screen until dismissed). */
  notice: SessionNotice;
  dismissNotice: () => void;
  /** Client for account calls (`auth: true`); marketplace code keeps using the public client. */
  api: ApiClient;
  signIn: (input: { email: string; password: string }) => Promise<void>;
  /** Verifies a one-time code (and, with `displayName`, creates the account) and signs in. */
  signInWithCode: (input: OtpVerifyInput) => Promise<void>;
  /** Google sign-in in the system auth session. Throws `GoogleSignInError` (`cancelled` when closed). */
  signInWithGoogle: () => Promise<void>;
  /** Finishes a Google sign-in from a `nesafric://auth/google` link; `false` if there was nothing to finish. */
  completeGoogleRedirect: (url: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  /** Retries whatever the last sign-out couldn't finish (server revocation and/or device deletion). */
  retrySignOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export const ACCOUNT_QUERY_KEY = ["account"] as const;

/** 2xx means no session row remains for the token; 401 means the server already rejects it. */
function serverOutcome(error: unknown): ServerSignOut {
  return error instanceof ApiError && error.status === 401 ? "ended" : "notConfirmed";
}

export function SessionProvider({ apiUrl, children }: { apiUrl: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>("restoring");
  const [user, setUser] = useState<StoredUser | null>(null);
  const [notice, setNotice] = useState<SessionNotice>(null);
  // Only read and written in handlers and effects, never during render.
  const expiresAtRef = useRef<string | null>(null);
  /** The signed-out token, kept in memory only so "Try again" can re-ask the server to revoke it. */
  const unrevokedTokenRef = useRef<string | null>(null);
  /** Bumped on every sign-in / sign-out so a late result can't overwrite a newer state. */
  const generationRef = useRef(0);

  const api = useMemo(() => createApiClient({ baseUrl: apiUrl, getToken: getActiveToken, onUnauthenticated: reportSessionLost }), [apiUrl]);

  /** Stops local use of the session at once: no token for new requests, account queries cancelled. */
  const dropLocally = useCallback(() => {
    generationRef.current += 1;
    setActiveToken(null);
    setUser(null);
    setStatus("signedOut");
    void queryClient.cancelQueries({ queryKey: ACCOUNT_QUERY_KEY });
    queryClient.removeQueries({ queryKey: ACCOUNT_QUERY_KEY });
    // Which workspace was open last is nobody else's business on a shared phone.
    void clearLastWorkspaces();
    return generationRef.current;
  }, [queryClient]);

  const revoke = useCallback(
    async (token: string, generation: number) => {
      const server = await revokeSession(api, token).then(() => "ended" as const, serverOutcome);
      if (generation !== generationRef.current) return;
      if (server === "ended") unrevokedTokenRef.current = null;
      setNotice((current) => (current?.kind === "signedOut" ? { ...current, server } : current));
    },
    [api],
  );

  // Expired or revoked (logout elsewhere, password change): drop it and fall back to guest.
  useEffect(() => {
    setSessionLostHandler(() => {
      const generation = dropLocally();
      unrevokedTokenRef.current = null;
      setNotice({ kind: "expired", device: "cleared" });
      void clearLocalSession().then((device) => {
        if (generation === generationRef.current && device !== "cleared") setNotice({ kind: "expired", device });
      });
    });
    return () => setSessionLostHandler(null);
  }, [dropLocally]);

  useEffect(() => {
    let cancelled = false;
    const generation = generationRef.current;
    loadSession().then((stored) => {
      if (cancelled || generation !== generationRef.current) return;
      setActiveToken(stored?.token ?? null);
      expiresAtRef.current = stored?.expiresAt ?? null;
      setUser(stored?.user ?? null);
      setStatus(stored ? "signedIn" : "signedOut");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Stores and starts using a new session: the same path for password and Google sign-in. */
  const adoptSession = useCallback(
    async (session: MobileSessionResponse) => {
      // Both deliveries of one Google redirect resolve to the same session: adopt it once.
      if (getActiveToken() === session.token) return;
      await saveSession({ token: session.token, expiresAt: session.expiresAt, user: session.user });
      generationRef.current += 1;
      queryClient.removeQueries({ queryKey: ACCOUNT_QUERY_KEY });
      setActiveToken(session.token);
      expiresAtRef.current = session.expiresAt;
      unrevokedTokenRef.current = null;
      setUser(session.user);
      setNotice(null);
      setStatus("signedIn");
    },
    [queryClient],
  );

  const signIn = useCallback(
    async (input: { email: string; password: string }) => adoptSession(await createMobileSession(api, input)),
    [api, adoptSession],
  );

  const signInWithCode = useCallback(
    async (input: OtpVerifyInput) => adoptSession(await verifyOtpForSession(api, input)),
    [api, adoptSession],
  );

  const signInWithGoogle = useCallback(async () => adoptSession(await runGoogleSignIn(api, apiUrl)), [api, apiUrl, adoptSession]);

  const completeGoogleRedirect = useCallback(
    async (url: string) => {
      const session = await completeGoogle(api, url);
      if (!session) return false;
      await adoptSession(session);
      return true;
    },
    [api, adoptSession],
  );

  const signOut = useCallback(async () => {
    const token = getActiveToken();
    if (!token) return;
    const expiresAt = expiresAtRef.current;
    const generation = dropLocally();
    unrevokedTokenRef.current = token;
    setNotice({ kind: "signedOut", server: "pending", device: "cleared", expiresAt });
    // Server revocation runs in the background; the device is already signed out.
    void revoke(token, generation);
    const device = await clearLocalSession();
    if (generation === generationRef.current) setNotice((current) => (current?.kind === "signedOut" ? { ...current, device } : current));
  }, [dropLocally, revoke]);

  const retrySignOut = useCallback(async () => {
    const generation = generationRef.current;
    if (notice?.device === "failed") {
      const device = await clearLocalSession();
      if (generation === generationRef.current) setNotice((current) => (current ? { ...current, device } : current));
    }
    const token = unrevokedTokenRef.current;
    if (notice?.kind === "signedOut" && notice.server === "notConfirmed" && token) {
      setNotice((current) => (current?.kind === "signedOut" ? { ...current, server: "pending" } : current));
      await revoke(token, generation);
    }
  }, [notice, revoke]);

  const dismissNotice = useCallback(() => {
    unrevokedTokenRef.current = null;
    setNotice(null);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ status, user, notice, dismissNotice, api, signIn, signInWithCode, signInWithGoogle, completeGoogleRedirect, signOut, retrySignOut }),
    [status, user, notice, dismissNotice, api, signIn, signInWithCode, signInWithGoogle, completeGoogleRedirect, signOut, retrySignOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside <SessionProvider>.");
  return context;
}
