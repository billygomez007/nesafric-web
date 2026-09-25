import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { createMobileSession, revokeSession } from "@/api/account";
import { createApiClient, type ApiClient } from "@/api/client";
import { clearSession, getActiveToken, loadSession, reportSessionLost, saveSession, setActiveToken, setSessionLostHandler, type StoredUser } from "./token-store";

/**
 * Optional sign-in. The marketplace never waits for or depends on this: guests browse, save and
 * enquire exactly as before. Account data lives under the `["account"]` query key and is removed on
 * sign-out or session loss; marketplace data and device-saved properties are left alone.
 */
export type SessionStatus = "restoring" | "signedOut" | "signedIn";
export type SessionNotice = "expired" | null;

type SessionContextValue = {
  status: SessionStatus;
  user: StoredUser | null;
  /** Why the user was signed out without asking (shown once on the Account screen). */
  notice: SessionNotice;
  dismissNotice: () => void;
  /** Client for account calls (`auth: true`); marketplace code keeps using the public client. */
  api: ApiClient;
  signIn: (input: { email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export const ACCOUNT_QUERY_KEY = ["account"] as const;

export function SessionProvider({ apiUrl, children }: { apiUrl: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>("restoring");
  const [user, setUser] = useState<StoredUser | null>(null);
  const [notice, setNotice] = useState<SessionNotice>(null);

  const endLocally = useCallback(
    async (reason: SessionNotice) => {
      setActiveToken(null);
      setUser(null);
      setStatus("signedOut");
      setNotice(reason);
      queryClient.removeQueries({ queryKey: ACCOUNT_QUERY_KEY });
      await clearSession();
    },
    [queryClient],
  );

  const api = useMemo(() => createApiClient({ baseUrl: apiUrl, getToken: getActiveToken, onUnauthenticated: reportSessionLost }), [apiUrl]);

  // Expired or revoked (logout elsewhere, password change): drop it and fall back to guest.
  useEffect(() => {
    setSessionLostHandler(() => void endLocally("expired"));
    return () => setSessionLostHandler(null);
  }, [endLocally]);

  useEffect(() => {
    let cancelled = false;
    loadSession().then((stored) => {
      if (cancelled) return;
      setActiveToken(stored?.token ?? null);
      setUser(stored?.user ?? null);
      setStatus(stored ? "signedIn" : "signedOut");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (input: { email: string; password: string }) => {
      const session = await createMobileSession(api, input);
      await saveSession({ token: session.token, expiresAt: session.expiresAt, user: session.user });
      queryClient.removeQueries({ queryKey: ACCOUNT_QUERY_KEY });
      setActiveToken(session.token);
      setUser(session.user);
      setNotice(null);
      setStatus("signedIn");
    },
    [api, queryClient],
  );

  const signOut = useCallback(async () => {
    // Revoke on the server when reachable; the local session is cleared either way.
    await revokeSession(api).catch(() => undefined);
    await endLocally(null);
  }, [api, endLocally]);

  const value = useMemo<SessionContextValue>(
    () => ({ status, user, notice, dismissNotice: () => setNotice(null), api, signIn, signOut }),
    [status, user, notice, api, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside <SessionProvider>.");
  return context;
}
