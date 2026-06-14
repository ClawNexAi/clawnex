"use client";

import { useState, useEffect, type FormEvent } from "react";

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
/* Password strength helper                                                   */
/* -------------------------------------------------------------------------- */

function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  // Count character classes present
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^A-Za-z0-9]/.test(pw)) classes++;

  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  // Only award class diversity if 2+ different classes
  if (classes >= 2) score++;
  if (classes >= 3) score++;
  if (classes >= 4) score++;

  if (score <= 1) return { score, label: 'Weak', color: '#f43f5e' };
  if (score <= 2) return { score, label: 'Fair', color: '#fbbf24' };
  if (score <= 3) return { score, label: 'Good', color: '#38bdf8' };
  return { score, label: 'Strong', color: '#00e5a0' };
}

/* -------------------------------------------------------------------------- */
/* Setup Page — first-visit admin creation wizard                             */
/* -------------------------------------------------------------------------- */

export default function SetupPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [hasSecretInUrl, setHasSecretInUrl] = useState(false);
  // Auto-expand the SETUP_SECRET disclosure when there's no URL secret —
  // the operator NEEDS to paste it somehow, so saving them a click reads as
  // helpful rather than noisy. Falls back to closed when URL has secret.
  const [warningOpen, setWarningOpen] = useState(true);
  // 2026-05-07: paste-into-form alternative to ?secret=<hex> URL flow.
  // POSTed via existing setup endpoint (no backend changes); typed value
  // wins over URL param when both are present (operator's most recent
  // intent — principle of least surprise).
  const [secretInput, setSecretInput] = useState("");
  const [secretRevealed, setSecretRevealed] = useState(false);

  // Redirect away if setup is already completed
  useEffect(() => {
    if (typeof window !== "undefined") {
      const secret = new URLSearchParams(window.location.search).get("secret");
      setHasSecretInUrl(Boolean(secret));
      // When the URL already carries the secret, collapse the disclosure —
      // the operator doesn't need to interact with this section.
      if (secret) setWarningOpen(false);
    }
    (async () => {
      try {
        const res = await fetch("/api/auth/status");
        if (res.ok) {
          const data = await res.json();
          if (!data.needsSetup) { window.location.href = "/login"; return; }
          // Fresh install: nuke any dashboard state from a previous tenant
          // that may still live in this browser's localStorage. Without this,
          // a wipe-and-redeploy on the server still leaves panel layouts,
          // collapsed/expanded tabs, and theme prefs intact for whichever
          // operator last logged in from this browser — which fails the
          // "is the wipe truly complete" smell test.
          if (typeof window !== "undefined") {
            try { window.localStorage.clear(); } catch {}
          }
        }
      } catch {}
      setReady(true);
    })();
  }, []);

  function validate(): string | null {
    if (!username.trim()) return "Username is required";
    if (username.trim().length < 3) return "Username must be at least 3 characters";
    if (password.length < 8) return "Password must be at least 8 characters";
    if (password !== confirmPassword) return "Passwords do not match";
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    // Resolve the SETUP_SECRET from one of two sources, in priority order:
    //   1. Typed input (operator's most recent intent — principle of least
    //      surprise; if they bothered to type something it should win).
    //   2. URL ?secret= parameter (legacy/deep-link flow, preserved unchanged).
    // Either path POSTs through the same constant-time-validated endpoint.
    let resolvedSecret: string | undefined;
    if (secretInput.trim().length > 0) {
      resolvedSecret = secretInput.trim();
    } else if (typeof window !== 'undefined') {
      resolvedSecret = new URLSearchParams(window.location.search).get('secret') || undefined;
    }

    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim() || undefined,
          password,
          setup_secret: resolvedSecret,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Setup failed");
        setLoading(false);
        return;
      }

      // Full page reload — session cookie is now set
      window.location.href = "/";
    } catch {
      setError("Network error. Is the server running?");
      setLoading(false);
    }
  }

  if (!ready) {
    return <div style={{ minHeight: "100vh", background: C.bg }} />;
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
          maxWidth: 420,
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
        <div style={{ textAlign: "center", marginBottom: 4 }}>
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
            Welcome to ClawNex
          </h1>
        </div>

        <h2
          style={{
            textAlign: "center",
            color: C.tx,
            fontSize: 16,
            fontWeight: 600,
            margin: "12px 0 4px 0",
          }}
        >
          Create Your Admin Account
        </h2>

        <p
          style={{
            textAlign: "center",
            color: C.txS,
            fontSize: 13,
            margin: "0 0 28px 0",
            lineHeight: 1.5,
          }}
        >
          This is a one-time setup. You&apos;re creating the first administrator
          account.

        </p>
        {!hasSecretInUrl && (
          <div
            style={{
              marginTop: 4,
              marginBottom: 20,
              padding: warningOpen ? "10px 14px 12px" : "8px 14px",
              background: "rgba(251, 191, 36, 0.08)",
              border: "1px solid rgba(251, 191, 36, 0.4)",
              borderRadius: 10,
              fontSize: 12,
              color: "#fbbf24",
              lineHeight: 1.55,
              textAlign: "left",
            }}
          >
            <button
              type="button"
              onClick={() => setWarningOpen(o => !o)}
              aria-expanded={warningOpen}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: 0,
                background: "transparent",
                border: "none",
                color: "#fbbf24",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: FONT,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1, transform: warningOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-block" }}>▶</span>
              <span style={{ flex: 1 }}>SETUP_SECRET required — read before submitting</span>
            </button>
            {warningOpen && (
              <div style={{ marginTop: 8, fontWeight: 400, color: "#fde68a" }}>
                If <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 6px", borderRadius: 4, fontFamily: "monospace" }}>SETUP_SECRET</code> is set in <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 6px", borderRadius: 4, fontFamily: "monospace" }}>.env.local</code> on the host
                (default for any non-localhost install), provide the value below — either by appending <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 6px", borderRadius: 4, fontFamily: "monospace" }}>?secret=&lt;value&gt;</code> to the URL or by pasting it into the input below. Submitting without the secret will fail with &quot;invalid setup secret.&quot;
                {" "}<br/>Recover the value with: <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 6px", borderRadius: 4, fontFamily: "monospace" }}>grep SETUP_SECRET .env.local</code>

                {/* 2026-05-07: paste-into-form alternative to URL ?secret=
                    flow. Same endpoint, same validation, less leakage (URL
                    secrets travel through history / SSL terminator logs /
                    server access logs; form-body secrets don't). */}
                <div style={{ marginTop: 12 }}>
                  <label
                    htmlFor="setup-secret-input"
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#fde68a",
                      marginBottom: 4,
                      letterSpacing: "0.03em",
                    }}
                  >
                    SETUP_SECRET
                  </label>
                  <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                    <input
                      id="setup-secret-input"
                      type={secretRevealed ? "text" : "password"}
                      autoComplete="off"
                      spellCheck={false}
                      value={secretInput}
                      onChange={(e) => setSecretInput(e.target.value)}
                      placeholder="Paste the secret from .env.local"
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: 6,
                        border: "1px solid rgba(251, 191, 36, 0.4)",
                        background: "rgba(0,0,0,0.4)",
                        color: "#fde68a",
                        fontSize: 12,
                        fontFamily: "monospace",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setSecretRevealed(r => !r)}
                      aria-label={secretRevealed ? "Hide secret" : "Reveal secret"}
                      style={{
                        padding: "0 10px",
                        borderRadius: 6,
                        border: "1px solid rgba(251, 191, 36, 0.4)",
                        background: "rgba(0,0,0,0.4)",
                        color: "#fde68a",
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: FONT,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {secretRevealed ? "Hide" : "Show"}
                    </button>
                  </div>
                  {secretInput.trim().length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 11, color: "#86efac", fontWeight: 500 }}>
                      ✓ Will use pasted secret on submit
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

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
          placeholder="admin"
        />

        {/* Email */}
        <label style={{ ...labelStyle, marginTop: 16 }}>Email <span style={{ color: C.txT, fontWeight: 400 }}>(optional)</span></label>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
          placeholder="admin@example.com"
        />

        {/* Password */}
        <label style={{ ...labelStyle, marginTop: 16 }}>Password</label>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
          placeholder="Min 8 characters"
        />
        <div style={{ fontSize: 10, color: C.txT, marginTop: 4, lineHeight: 1.4 }}>
          Minimum 8 characters. Use a mix of letters, numbers, and symbols for a strong password.
        </div>
        {password && (() => {
          const strength = getPasswordStrength(password);
          return (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 4, background: '#14213d', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(strength.score / 5) * 100}%`, height: '100%', background: strength.color, borderRadius: 2, transition: 'width 0.3s, background 0.3s' }} />
              </div>
              <span style={{ fontSize: 10, color: strength.color, fontWeight: 600, minWidth: 40 }}>{strength.label}</span>
            </div>
          );
        })()}

        {/* Confirm Password */}
        <label style={{ ...labelStyle, marginTop: 16 }}>
          Confirm Password
        </label>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          style={inputStyle}
          placeholder="Re-enter password"
        />

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
          {loading ? "Creating account..." : "Create Admin & Login"}
        </button>

        <p style={{ textAlign: "center", margin: "20px 0 0 0" }}>
          <a href="https://clawnexai.com" target="_blank" rel="noopener noreferrer" style={{ color: C.txT, fontSize: 10, letterSpacing: "0.06em", opacity: 0.5, textDecoration: "none", transition: "opacity 0.2s" }} onMouseEnter={e => { (e.target as HTMLElement).style.opacity = "0.8"; }} onMouseLeave={e => { (e.target as HTMLElement).style.opacity = "0.5"; }}>
            A ClawNex Project
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
