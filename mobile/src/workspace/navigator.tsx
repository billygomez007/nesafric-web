import { router, usePathname, useRootNavigationState } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef } from "react";

import { useWorkspaces } from "@/api/account-queries";
import { useSession } from "@/auth/session";
import { loadLastWorkspace } from "@/auth/workspaces";
import { setWorkspaceIntent } from "./intent";
import { resolveAvailableWorkspaces } from "./resolve";
import { destinationHref, resolveLaunchDestination, resolvePostSignInDestination, type Destination, type SignInIntent } from "./routing";

/**
 * The single place that moves the app between the marketplace and workspaces on its own:
 * - at launch, a restored session resumes the last workspace if the server still lists it;
 * - right after sign-in, the chosen intent opens the matching workspace, or its set-up screen.
 * Every decision uses the server's current `/api/workspaces`; nothing local can add a workspace.
 */
let pendingSignIn: SignInIntent | null = null;
let launchDecided = false;
let splashHidden = false;

/** Set by the sign-in screen when it submits (null again if sign-in fails). */
export function requestPostSignInRouting(intent: SignInIntent | null) {
  pendingSignIn = intent;
}

/** Test hook: every app start begins undecided. */
export function resetWorkspaceNavigator() {
  pendingSignIn = null;
  launchDecided = false;
  splashHidden = false;
}

export function hideSplashOnce() {
  if (splashHidden) return;
  splashHidden = true;
  void SplashScreen.hideAsync();
}

// Never keep a signed-in person on the splash screen for long: past this, open the marketplace
// and let them choose.
const LAUNCH_WAIT_MS = 2500;

function go(destination: Destination) {
  // Marketplace: stay where the person already is (Home, Search, Saved or Account are all the
  // marketplace), rather than pulling them to another tab.
  if (destination.type === "marketplace") return;

  const href = destinationHref(destination);

  // Expo Router stringifies dynamic params internally. A malformed or stale server payload with
  // a null route parameter must never crash the app during launch restoration.
  if (typeof href === "string") {
    if (!href.trim()) return;
    router.push(href);
    return;
  }

  if (!href || typeof href !== "object") return;

  const pathname = "pathname" in href ? href.pathname : undefined;
  if (pathname == null || String(pathname).trim().length === 0) return;

  const params = "params" in href ? href.params : undefined;
  if (
    params &&
    Object.values(params).some(
      (value) =>
        value == null ||
        (typeof value === "string" && value.trim().length === 0),
    )
  ) {
    return;
  }

  router.push(href);
}

export function WorkspaceNavigator() {
  const { status, user } = useSession();
  const workspaces = useWorkspaces();
  const pathname = usePathname();
  const navigationReady = Boolean(useRootNavigationState()?.key);
  // Mount-scoped, not effect-scoped: a re-render (the sign-in sheet closing) must not cancel a
  // navigation already decided.
  const mounted = useRef(true);
  const currentPath = useRef(pathname);
  useEffect(() => {
    currentPath.current = pathname;
  }, [pathname]);
  useEffect(() => () => void (mounted.current = false), []);

  useEffect(() => {
    const timer = setTimeout(() => {
      launchDecided = true;
      hideSplashOnce();
    }, LAUNCH_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!navigationReady) return;
    if (status === "restoring") return;
    if (status === "signedOut") {
      launchDecided = true;
      pendingSignIn = null;
      hideSplashOnce();
      return;
    }
    if (!user) return;
    if (!workspaces.data) {
      // Offline or failing: open the marketplace rather than wait.
      if (workspaces.isError) {
        launchDecided = true;
        pendingSignIn = null;
        hideSplashOnce();
      }
      return;
    }
    const data = workspaces.data;
    const available = resolveAvailableWorkspaces({ status, workspaces: data });
    if (pendingSignIn) {
      const intent = pendingSignIn;
      pendingSignIn = null;
      launchDecided = true;
      void loadLastWorkspace(user.id, data).then((last) => {
        if (!mounted.current) return;
        setWorkspaceIntent(null);
        go(resolvePostSignInDestination(intent, available, last));
      });
    } else if (!launchDecided) {
      launchDecided = true;
      void loadLastWorkspace(user.id, data).then((last) => {
        // Only from the Home entry point: a deep link (a listing, an enquiry) is respected.
        if (mounted.current && currentPath.current === "/") {
          const destination = resolveLaunchDestination(available, last);
          if (destination.type === "workspace") go(destination);
        }
        hideSplashOnce();
      });
    }
  }, [navigationReady, status, user, workspaces.data, workspaces.isError]);

  return null;
}
