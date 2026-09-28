"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { trackEvent } from "@/platform/analytics";
import { safeReturnTo } from "@/platform/auth/return-to";
import { buttonClass } from "@/components/ui/button-styles";
import { controlClass } from "@/components/ui/field-styles";
import { resolveSignInDestination, type SignInWorkspaces } from "@/lib/workspace-destination";

/**
 * Passwordless sign-in and sign-up: a one-time code by text message or email, or Google.
 *
 * Steps: choose Phone / Email → enter it (and a name when creating an account) → "Send code" →
 * enter the 6-digit code → "Verify". The server never says whether an address has an account
 * before the code is verified; after that, signing in with an address that has no account offers
 * to create one with the same (still valid) code, and creating an account with an address that
 * already has one simply signs into it.
 *
 * The code itself is never put in analytics, URLs or logs.
 */
type Mode = "login" | "register";
type Method = "sms" | "email";
type Step = "identifier" | "code" | "noAccount";
type Challenge = { challengeId: string; destination: string; resendAt: number };

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.32 2.98-7.41Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.97-.9 6.63-2.36l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.93A6 6 0 0 1 6.08 12c0-.67.11-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.38 3.13 1.04 4.55l3.35-2.62Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.94c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z"
      />
    </svg>
  );
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, payload };
}

const failure = (payload: { error?: { message?: string } } | undefined, fallback: string) => new Error(payload?.error?.message ?? fallback);

/** "It expires in N minutes." from the server's `expiresAt` (5 for SMS, 10 for email). */
function expiryText(expiresAt: unknown) {
  const minutes = typeof expiresAt === "string" ? Math.round((Date.parse(expiresAt) - Date.now()) / 60_000) : NaN;
  return Number.isFinite(minutes) && minutes > 0 ? `It expires in ${minutes} minute${minutes === 1 ? "" : "s"}.` : "";
}

/** Seconds until `at`, ticking once a second while positive. */
function useCountdown(at: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [at]);
  return at ? Math.max(0, Math.ceil((at - now) / 1000)) : 0;
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>("sms");
  const [step, setStep] = useState<Step>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const secondsLeft = useCountdown(challenge?.resendAt ?? null);
  const errorId = useId();
  const hintId = useId();

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
    if (step === "noAccount") nameRef.current?.focus();
  }, [step]);

  async function run(work: () => Promise<"done" | void>) {
    // A ref, not state: two clicks in the same frame must not send two requests.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    let done = false;
    try {
      done = (await work()) === "done";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
    } finally {
      // Signed in: stay locked while the page navigates away.
      if (!done) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  function chooseMethod(next: Method) {
    if (next === method) return;
    setMethod(next);
    setIdentifier("");
    setStep("identifier");
    setChallenge(null);
    setCode("");
    setError("");
    setNotice("");
  }

  const sendCode = () =>
    run(async () => {
      const { ok, payload } = await postJson("/api/auth/otp/request", { mode, channel: method, identifier });
      if (!ok) throw failure(payload, "We couldn’t send a code. Please try again.");
      setChallenge({ challengeId: payload.challengeId, destination: payload.destination, resendAt: Date.now() + (payload.resendAfterSeconds ?? 60) * 1000 });
      setCode("");
      setNotice(`We sent a 6-digit code to ${payload.destination}. ${expiryText(payload.expiresAt)}`);
      setStep("code");
    });

  const verify = (withName: boolean) =>
    run(async () => {
      if (!challenge) return;
      const { ok, payload } = await postJson("/api/auth/otp/verify", {
        challengeId: challenge.challengeId,
        channel: method,
        identifier,
        code,
        ...(withName ? { displayName } : {}),
      });
      if (!ok) {
        if (payload?.error?.code === "OTP_NO_ACCOUNT") {
          setNotice(payload.error.message);
          setStep("noAccount");
          return;
        }
        throw failure(payload, "We couldn’t verify that code. Please try again.");
      }
      const created = Boolean(payload.created);
      trackEvent(created ? "sign_up" : "login", { method: method === "sms" ? "phone" : "email" });
      // `?returnTo=/path` lets a caller that cannot set the return-to cookie (the mobile app's
      // in-app browser) choose where to land. Same-origin paths only (`safeReturnTo`).
      const queryReturnTo = safeReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
      let destination: string;
      if (typeof payload.returnTo === "string" && payload.returnTo.startsWith("/")) destination = payload.returnTo;
      else if (queryReturnTo) destination = queryReturnTo;
      else if (created) destination = "/onboarding";
      else {
        const resolved = resolveSignInDestination(payload.workspaces as SignInWorkspaces | undefined);
        if (resolved.remember) localStorage.setItem(resolved.remember.key, resolved.remember.value);
        destination = resolved.path;
      }
      router.push(destination);
      router.refresh();
      return "done";
    });

  function submitIdentifier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendCode();
  }

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void verify(mode === "register");
  }

  function submitName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void verify(true);
  }

  const phone = method === "sms";
  const errorBox = error ? (
    <p className="border-l-2 border-danger bg-danger-tint p-3 text-sm leading-5 text-danger-ink" id={errorId} role="alert">
      {error}
    </p>
  ) : null;

  return (
    <div className="mt-8">
      <a
        className="flex min-h-11 w-full items-center justify-center gap-3 rounded-control border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-forest transition hover:border-forest/40 hover:bg-warm-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-strong"
        href="/api/auth/google/start"
      >
        <GoogleIcon />
        Continue with Google
      </a>

      <div aria-hidden="true" className="my-6 flex items-center gap-4">
        <div className="h-px flex-1 bg-hairline" />
        <span className="text-xs font-medium uppercase tracking-[0.15em] text-muted">or</span>
        <div className="h-px flex-1 bg-hairline" />
      </div>

      <div aria-label={mode === "register" ? "Create your account with" : "Sign in with"} className="grid grid-cols-2 gap-1 rounded-control border border-hairline bg-warm-white p-1" role="group">
        {(["sms", "email"] as const).map((option) => (
          <button
            aria-pressed={method === option}
            className={`min-h-10 rounded-control text-sm font-semibold transition-colors ${method === option ? "bg-white text-forest shadow-sm" : "text-muted hover:text-forest"}`}
            disabled={busy}
            key={option}
            onClick={() => chooseMethod(option)}
            type="button"
          >
            {option === "sms" ? "Phone" : "Email"}
          </button>
        ))}
      </div>

      {step === "identifier" && (
        <form className="mt-5 space-y-5" noValidate onSubmit={submitIdentifier}>
          {mode === "register" && (
            <label className="block text-sm font-semibold text-forest">
              Your name
              <input autoComplete="name" className={`mt-2 ${controlClass}`} maxLength={100} minLength={2} name="displayName" onChange={(event) => setDisplayName(event.target.value)} required value={displayName} />
            </label>
          )}
          {phone ? (
            <label className="block text-sm font-semibold text-forest">
              Mobile number
              <input
                aria-describedby={hintId}
                autoComplete="tel"
                className={`mt-2 ${controlClass}`}
                inputMode="tel"
                name="phone"
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="024 123 4567"
                required
                type="tel"
                value={identifier}
              />
            </label>
          ) : (
            <label className="block text-sm font-semibold text-forest">
              Email
              <input autoComplete="email" className={`mt-2 ${controlClass}`} inputMode="email" name="email" onChange={(event) => setIdentifier(event.target.value)} required type="email" value={identifier} />
            </label>
          )}
          {phone && (
            <p className="-mt-3 text-xs text-muted" id={hintId}>
              Ghana numbers can start with 0. For other countries, start with + and the country code.
            </p>
          )}
          {errorBox}
          <button
            className={`${buttonClass("primary")} w-full disabled:cursor-not-allowed`}
            disabled={busy || !identifier.trim() || (mode === "register" && displayName.trim().length < 2)}
            type="submit"
          >
            {busy ? "Sending…" : "Send code"}
          </button>
          <p className="text-center text-xs leading-5 text-muted">
            {phone ? "We’ll text you a 6-digit code." : "We’ll email you a 6-digit code."} No password needed.
          </p>
        </form>
      )}

      {step === "code" && challenge && (
        <form className="mt-5 space-y-5" noValidate onSubmit={submitCode}>
          <p aria-live="polite" className="text-sm leading-6 text-muted">{notice}</p>
          <label className="block text-sm font-semibold text-forest">
            6-digit code
            <input
              aria-describedby={error ? errorId : undefined}
              aria-invalid={Boolean(error)}
              autoComplete="one-time-code"
              className={`mt-2 ${controlClass} text-center font-mono text-xl tracking-[0.5em]`}
              inputMode="numeric"
              maxLength={6}
              name="code"
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              pattern="\d{6}"
              ref={codeRef}
              required
              value={code}
            />
          </label>
          {errorBox}
          <button className={`${buttonClass("primary")} w-full disabled:cursor-not-allowed`} disabled={busy || code.length !== 6} type="submit">
            {busy ? "Verifying…" : mode === "register" ? "Verify & create account" : "Verify & sign in"}
          </button>
          <div className="flex items-center justify-between gap-3 text-sm">
            <button className="font-semibold text-emerald underline-offset-4 hover:underline" disabled={busy} onClick={() => { setStep("identifier"); setError(""); }} type="button">
              {phone ? "Change number" : "Change email"}
            </button>
            {secondsLeft > 0 ? (
              <span className="text-muted">
                <span aria-hidden="true">Resend in {secondsLeft}s</span>
                <span className="sr-only">You can request a new code in about a minute.</span>
              </span>
            ) : (
              <button className="font-semibold text-emerald underline-offset-4 hover:underline disabled:text-muted" disabled={busy} onClick={() => void sendCode()} type="button">
                Resend code
              </button>
            )}
          </div>
        </form>
      )}

      {step === "noAccount" && (
        <form className="mt-5 space-y-5" noValidate onSubmit={submitName}>
          <p aria-live="polite" className="text-sm leading-6 text-forest">{notice}</p>
          <label className="block text-sm font-semibold text-forest">
            Your name
            <input autoComplete="name" className={`mt-2 ${controlClass}`} maxLength={100} minLength={2} name="displayName" onChange={(event) => setDisplayName(event.target.value)} ref={nameRef} required value={displayName} />
          </label>
          {errorBox}
          <button className={`${buttonClass("primary")} w-full disabled:cursor-not-allowed`} disabled={busy || displayName.trim().length < 2} type="submit">
            {busy ? "Creating…" : "Create account"}
          </button>
          <button className={`${buttonClass("secondary")} w-full`} disabled={busy} onClick={() => chooseMethod(phone ? "email" : "sms")} type="button">
            Use {phone ? "email" : "a phone number"} instead
          </button>
        </form>
      )}
    </div>
  );
}
