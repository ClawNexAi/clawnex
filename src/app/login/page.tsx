"use client";

import { useState, useEffect, type FormEvent } from "react";
import { startAuthentication } from "@simplewebauthn/browser";

/* -------------------------------------------------------------------------- */
/* Design tokens — hardcoded to avoid importing dashboard constants.          */
/* -------------------------------------------------------------------------- */

const C = {
  bg: "#04070e",
  srf: "#101d34",
  brd: "#14213d",
  brand: "#00e5a0",
  danger: "#f43f5e",
  tx: "#e5eaf3",
  txS: "#8899bb",
  txT: "#556a90",
} as const;

const FONT =
  "'Plus Jakarta Sans', 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/* -------------------------------------------------------------------------- */
/* Login Page                                                                 */
/* -------------------------------------------------------------------------- */

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [githubAvailable, setGithubAvailable] = useState(false);
  const [magicLinkAvailable, setMagicLinkAvailable] = useState(false);
  const [showMagicLink, setShowMagicLink] = useState(false);
  const [magicEmail, setMagicEmail] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);

  // Show "session expired" or OAuth error message from query string.
  //
  // We deliberately collapse every OAuth error code to a single generic
  // message (adversarial review finding #A3, 2026-04-24). The specific
  // failure mode is already captured in the server-side audit log
  // (logEvent calls in /api/auth/github/callback), which is where an
  // admin should debug from. Showing granular "GitHub account not
  // linked" or "rate limited" messages to unauthenticated browsers
  // offers attackers reconnaissance and social-engineering surface
  // without giving the legitimate user meaningfully better recovery
  // options — they can't self-serve the fix either way.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("expired") === "1") {
      setError("Your session has expired. Please sign in again.");
      return;
    }
    if (qs.get("error")) {
      setError("Sign-in failed. Please try a different method or contact your admin for assistance.");
    }
  }, []);

  // Discover whether GitHub button should be shown. Anonymous response
  // from /api/auth/github/status returns only { available } to avoid
  // leaking enabled/configured/linked fields pre-auth (review finding #A2).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/github/status");
        if (res.ok) {
          const data = await res.json();
          setGithubAvailable(Boolean(data.available));
        }
      } catch {}
    })();
  }, []);

  // Check auth status on mount — redirect before showing the form.
  // Also picks up Magic Link availability (admin toggle + mail configured)
  // so we only render the email-me-a-link button when it would actually work.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/status");
        if (res.ok) {
          const data = await res.json();
          if (data.needsSetup) { window.location.href = "/setup"; return; }
          if (data.authenticated) { window.location.href = "/"; return; }
          setMagicLinkAvailable(Boolean(data.magicLinkAvailable));
        }
      } catch {}
      setReady(true);
    })();
  }, []);

  async function handleMagicLink(e: FormEvent) {
    e.preventDefault();
    if (!magicEmail.trim()) return;
    setError("");
    setMagicLoading(true);
    try {
      // begin endpoint always returns 200 + the same success message — we
      // never learn whether the email matched an operator. Show the same
      // "check your email" message in every case so a user can't tell
      // whether their typo matched anyone else's account.
      await fetch("/api/auth/magic-link/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: magicEmail.trim() }),
      });
      setMagicSent(true);
    } catch {
      setMagicSent(true);
    }
    setMagicLoading(false);
  }

  async function handlePasskey() {
    setError("");
    setPasskeyLoading(true);
    try {
      const beginRes = await fetch("/api/auth/passkey/authenticate/begin", { method: "POST" });
      if (!beginRes.ok) {
        setError("Could not start passkey sign-in.");
        setPasskeyLoading(false);
        return;
      }
      const { options } = await beginRes.json();

      // startAuthentication will prompt the OS/browser passkey UI
      const assertion = await startAuthentication({ optionsJSON: options });

      const completeRes = await fetch("/api/auth/passkey/authenticate/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion, remember }),
      });
      const data = await completeRes.json();
      if (!completeRes.ok) {
        setError(data.error || "Passkey sign-in failed");
        setPasskeyLoading(false);
        return;
      }
      window.location.href = "/";
    } catch (err) {
      // User cancelled the passkey prompt or no enrolled passkey — keep the
      // message generic so we don't leak whether any passkey exists.
      const msg = (err as Error)?.message ?? "";
      setError(msg.includes("NotAllowed") ? "Passkey sign-in cancelled." : "Passkey sign-in failed.");
      setPasskeyLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, remember }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
        setLoading(false);
        return;
      }

      // Full page reload so the session cookie is picked up everywhere
      window.location.href = "/";
    } catch {
      setError("Network error. Is the server running?");
      setLoading(false);
    }
  }

  // Show minimal loading state while checking auth status — prevents flash
  if (!ready) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, fontFamily: FONT }}>
        <div style={{ textAlign: "center" }}>
          <img src="/clawnex-icon-dark.png" alt="ClawNex" width={64} height={64} style={{ objectFit: "contain", opacity: 0.6 }} />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: C.bg,
        fontFamily: FONT,
        padding: 24,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 400,
          background: `${C.srf}cc`,
          border: `1px solid ${C.brd}`,
          borderRadius: 16,
          padding: "40px 32px",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
      >
        {/* Logo / brand */}
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <img src="/clawnex-icon-dark.png" alt="ClawNex" width={96} height={96} style={{ objectFit: "contain", marginBottom: 12, display: "block", margin: "0 auto 12px" }} />
          <h1
            style={{
              margin: 0,
              fontSize: 30,
              fontWeight: 700,
              background: `linear-gradient(135deg, ${C.brand}, #38bdf8)`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              letterSpacing: "-0.02em",
            }}
          >
            ClawNex
          </h1>
        </div>

        <p
          style={{
            textAlign: "center",
            color: C.txS,
            fontSize: 13,
            margin: "0 0 32px 0",
            letterSpacing: "0.04em",
          }}
        >
          One nexus. Total control.
        </p>

        {/* Username */}
        <label style={labelStyle}>Username</label>
        <input
          type="text"
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={inputStyle}
          placeholder="operator"
        />

        {/* Password */}
        <label style={{ ...labelStyle, marginTop: 16 }}>Password</label>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
          placeholder="********"
        />

        {/* Remember me */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <input
            type="checkbox"
            id="remember"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            style={{ accentColor: '#00e5a0' }}
          />
          <label htmlFor="remember" style={{ fontSize: 12, color: C.txS, cursor: 'pointer' }}>
            Remember me for 30 days
          </label>
        </div>

        {/* Forgot password */}
        <div style={{ textAlign: "right", marginTop: 10 }}>
          <button type="button" onClick={() => { setShowForgot(!showForgot); setForgotSent(false); setError(""); }} style={{
            background: "none", border: "none", fontSize: 11, color: C.txT, cursor: "pointer",
            textDecoration: "underline", padding: 0, fontFamily: FONT,
          }}>Forgot your password?</button>
        </div>

        {/* Forgot password form */}
        {showForgot && !forgotSent && (
          <div style={{
            marginTop: 12, padding: "14px", borderRadius: 10,
            background: `${C.srf}`, border: `1px solid ${C.brd}`,
          }}>
            <p style={{ fontSize: 12, color: C.txS, margin: "0 0 10px", lineHeight: 1.5 }}>
              Enter your email address and we'll send you a reset link.
            </p>
            <input
              type="email"
              value={forgotEmail}
              onChange={e => setForgotEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.brd}`, background: C.bg, color: C.tx, fontSize: 13, fontFamily: FONT, outline: "none", boxSizing: "border-box" as const, marginBottom: 8 }}
            />
            <button type="button" disabled={!forgotEmail.trim() || forgotLoading} onClick={async () => {
              setForgotLoading(true);
              try {
                await fetch("/api/auth/forgot-password", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email: forgotEmail.trim() }),
                });
                setForgotSent(true);
              } catch {}
              setForgotLoading(false);
            }} style={{
              width: "100%", padding: "8px 0", borderRadius: 8, border: "none",
              background: !forgotEmail.trim() ? C.txT : C.brand, color: C.bg,
              fontSize: 13, fontWeight: 700, fontFamily: FONT,
              cursor: !forgotEmail.trim() ? "not-allowed" : "pointer",
              opacity: forgotLoading ? 0.7 : 1,
            }}>
              {forgotLoading ? "Sending..." : "Send Reset Link"}
            </button>
          </div>
        )}

        {/* Forgot password confirmation */}
        {forgotSent && (
          <div style={{
            marginTop: 12, padding: "14px", borderRadius: 10,
            background: `${C.brand}0c`, border: `1px solid ${C.brand}33`,
          }}>
            <p style={{ fontSize: 12, color: C.brand, margin: 0, lineHeight: 1.5, fontWeight: 600 }}>
              If an account with that email exists, a password reset link has been sent. Check your inbox.
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              marginTop: 16,
              padding: "10px 12px",
              borderRadius: 8,
              background: `${C.danger}18`,
              border: `1px solid ${C.danger}40`,
              color: C.danger,
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: 24,
            width: "100%",
            padding: "12px 0",
            borderRadius: 10,
            border: "none",
            background: loading ? C.txT : C.brand,
            color: C.bg,
            fontSize: 15,
            fontWeight: 700,
            fontFamily: FONT,
            cursor: loading ? "wait" : "pointer",
            transition: "background 0.2s, opacity 0.2s",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>

        {/* Alternative providers — Passkey is live, Magic Link is coming soon */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0 12px" }}>
          <div style={{ flex: 1, height: 1, background: C.brd }} />
          <span style={{ fontSize: 10, color: C.txT, letterSpacing: "0.08em" }}>OR</span>
          <div style={{ flex: 1, height: 1, background: C.brd }} />
        </div>

        <button
          type="button"
          onClick={handlePasskey}
          disabled={passkeyLoading}
          style={{
            width: "100%", padding: "10px 0", borderRadius: 10,
            border: `1px solid ${C.brand}66`, background: "transparent",
            color: C.brand, fontSize: 13, fontWeight: 600, fontFamily: FONT,
            cursor: passkeyLoading ? "wait" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            opacity: passkeyLoading ? 0.7 : 1,
          }}
        >
          <span aria-hidden style={{ fontSize: 14 }}>🔑</span>
          {passkeyLoading ? "Waiting for passkey..." : "Sign in with Passkey"}
        </button>

        {githubAvailable && (
          <button
            type="button"
            onClick={() => { window.location.href = "/api/auth/github/start"; }}
            style={{
              marginTop: 8, width: "100%", padding: "10px 0", borderRadius: 10,
              border: `1px solid ${C.brd}`, background: "#0d1117",
              color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: FONT,
              cursor: "pointer", display: "flex", alignItems: "center",
              justifyContent: "center", gap: 8,
            }}
          >
            <svg aria-hidden viewBox="0 0 16 16" width="16" height="16" style={{ display: "block", flexShrink: 0 }}>
              <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            Sign in with GitHub
          </button>
        )}

        {/* Magic Link — only shown when admin has enabled it + mail is
            configured. When the operator clicks, the button expands into
            an inline email form. After submit we show a constant "check
            your email" message regardless of whether the email matched
            anyone — the begin endpoint never reveals existence either. */}
        {magicLinkAvailable && !showMagicLink && !magicSent && (
          <button
            type="button"
            onClick={() => setShowMagicLink(true)}
            style={{
              marginTop: 8, width: "100%", padding: "10px 0", borderRadius: 10,
              border: `1px solid ${C.brd}`, background: "transparent",
              color: C.tx, fontSize: 13, fontWeight: 600, fontFamily: FONT,
              cursor: "pointer", display: "flex", alignItems: "center",
              justifyContent: "center", gap: 8,
            }}
          >
            <span aria-hidden style={{ fontSize: 14 }}>✉️</span>
            Email me a magic link
          </button>
        )}

        {magicLinkAvailable && showMagicLink && !magicSent && (
          // NOT a <form> — this UI is rendered INSIDE the outer login form
          // (which wraps the entire card for username/password submission).
          // Nested <form> elements are HTML-illegal: browsers preserve them
          // in the DOM at runtime but React's synthetic event system drops
          // the inner form's onSubmit, so the click falls through to a
          // native GET on the outer form (history: caused magic-link sends
          // to silently 404 + reset the page). We replace the inner form
          // with a <div> and drive the send from the Send button's
          // onClick → handleMagicLink directly. Enter-key submit is also
          // wired by listening on the input's onKeyDown.
          <div style={{ marginTop: 8 }}>
            <input
              type="email"
              value={magicEmail}
              onChange={e => setMagicEmail(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !magicLoading && magicEmail.trim()) {
                  e.preventDefault();
                  handleMagicLink(e as unknown as FormEvent);
                }
              }}
              placeholder="you@example.com"
              required
              autoFocus
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 10,
                border: `1px solid ${C.brd}`, background: C.bg,
                color: C.tx, fontSize: 13, fontFamily: FONT, outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => { setShowMagicLink(false); setMagicEmail(""); }}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 10,
                  border: `1px solid ${C.brd}`, background: "transparent",
                  color: C.txS, fontSize: 12, fontWeight: 600, fontFamily: FONT,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={(e) => handleMagicLink(e as unknown as FormEvent)}
                disabled={magicLoading || !magicEmail.trim()}
                style={{
                  flex: 2, padding: "10px 0", borderRadius: 10,
                  border: "none", background: C.brand,
                  color: C.bg, fontSize: 13, fontWeight: 700, fontFamily: FONT,
                  cursor: magicLoading ? "wait" : "pointer",
                  opacity: magicLoading || !magicEmail.trim() ? 0.7 : 1,
                }}
              >
                {magicLoading ? "Sending..." : "Send link"}
              </button>
            </div>
          </div>
        )}

        {magicSent && (
          <div style={{ marginTop: 8, padding: "12px 14px", borderRadius: 10, border: `1px solid ${C.brand}44`, background: `${C.brand}08`, fontSize: 12, color: C.tx, lineHeight: 1.5 }}>
            If an account with that email exists, a sign-in link has been sent. Check your inbox — the link expires in 15 minutes.
          </div>
        )}

        <p style={{ textAlign: "center", margin: "20px 0 0 0" }}>
          <a href="https://clawnexai.com" target="_blank" rel="noopener noreferrer" style={{ color: C.txT, fontSize: 10, letterSpacing: "0.06em", opacity: 0.5, textDecoration: "none", transition: "opacity 0.2s" }} onMouseEnter={e => { (e.target as HTMLElement).style.opacity = "0.8"; }} onMouseLeave={e => { (e.target as HTMLElement).style.opacity = "0.5"; }}>
            ProBizSystems
          </a>
        </p>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared inline styles                                                       */
/* -------------------------------------------------------------------------- */

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: C.txS,
  marginBottom: 6,
  letterSpacing: "0.03em",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 8,
  border: `1px solid ${C.brd}`,
  background: `${C.bg}cc`,
  color: C.tx,
  fontSize: 14,
  fontFamily: FONT,
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.2s",
};
