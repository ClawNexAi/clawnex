"use client";

import { useState, useEffect, type FormEvent } from "react";

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

function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^A-Za-z0-9]/.test(pw)) classes++;

  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (classes >= 2) score++;
  if (classes >= 3) score++;
  if (classes >= 4) score++;

  if (score <= 1) return { score, label: 'Weak', color: '#f43f5e' };
  if (score <= 2) return { score, label: 'Fair', color: '#fbbf24' };
  if (score <= 3) return { score, label: 'Good', color: '#38bdf8' };
  return { score, label: 'Strong', color: '#00e5a0' };
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 10,
  border: `1px solid ${C.brd}`,
  background: C.bg,
  color: C.tx,
  fontSize: 14,
  fontFamily: FONT,
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: C.txS,
  marginBottom: 6,
  letterSpacing: "0.03em",
};

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setToken(params.get("token"));
    }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Invalid reset link. No token found.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Reset failed");
        setLoading(false);
        return;
      }

      setSuccess(true);
    } catch {
      setError("Network error. Is the server running?");
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, fontFamily: FONT }}>
        <div style={{ textAlign: "center", color: C.txT, fontSize: 14 }}>
          <p>Invalid reset link. No token provided.</p>
          <a href="/login" style={{ color: C.brand, textDecoration: "none" }}>Return to login</a>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, fontFamily: FONT }}>
        <div style={{
          width: "100%", maxWidth: 400, background: `${C.srf}cc`, border: `1px solid ${C.brd}`,
          borderRadius: 16, padding: "40px 32px", textAlign: "center",
          backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#x2705;</div>
          <h2 style={{ color: C.tx, fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Password Reset</h2>
          <p style={{ color: C.txS, fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
            Your password has been updated. All existing sessions have been revoked. You can now log in with your new password.
          </p>
          <a href="/login" style={{
            display: "inline-block", padding: "12px 32px", borderRadius: 10, background: C.brand,
            color: C.bg, fontSize: 15, fontWeight: 700, textDecoration: "none", fontFamily: FONT,
          }}>Go to Login</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: C.bg, fontFamily: FONT, padding: 24,
    }}>
      <form onSubmit={handleSubmit} style={{
        width: "100%", maxWidth: 400, background: `${C.srf}cc`, border: `1px solid ${C.brd}`,
        borderRadius: 16, padding: "40px 32px",
        backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <img src="/clawnex-icon-dark.png" alt="ClawNex" width={64} height={64} style={{ objectFit: "contain", marginBottom: 12, display: "block", margin: "0 auto 12px" }} />
          <h1 style={{
            margin: 0, fontSize: 24, fontWeight: 700,
            background: `linear-gradient(135deg, ${C.brand}, #38bdf8)`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>Reset Password</h1>
        </div>

        <p style={{ textAlign: "center", color: C.txS, fontSize: 13, margin: "0 0 32px 0" }}>
          Enter your new password below.
        </p>

        <label style={labelStyle}>New Password</label>
        <input
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
          placeholder="Min 8 characters"
        />
        {password && (() => {
          const strength = getPasswordStrength(password);
          return (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, height: 3, background: C.brd, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(strength.score / 5) * 100}%`, height: '100%', background: strength.color, borderRadius: 2, transition: 'width 0.3s, background 0.3s' }} />
              </div>
              <span style={{ fontSize: 10, color: strength.color, fontWeight: 600, minWidth: 40 }}>{strength.label}</span>
            </div>
          );
        })()}

        <label style={{ ...labelStyle, marginTop: 16 }}>Confirm Password</label>
        <input
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          style={inputStyle}
          placeholder="Re-enter password"
        />

        {error && (
          <div style={{
            marginTop: 16, padding: "10px 12px", borderRadius: 8,
            background: `${C.danger}18`, border: `1px solid ${C.danger}40`,
            color: C.danger, fontSize: 13, lineHeight: 1.4,
          }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} style={{
          marginTop: 24, width: "100%", padding: "12px 0", borderRadius: 10, border: "none",
          background: loading ? C.txT : C.brand, color: C.bg, fontSize: 15, fontWeight: 700,
          fontFamily: FONT, cursor: loading ? "wait" : "pointer",
          transition: "background 0.2s, opacity 0.2s", opacity: loading ? 0.7 : 1,
        }}>
          {loading ? "Resetting..." : "Reset Password"}
        </button>

        <p style={{ textAlign: "center", margin: "16px 0 0 0" }}>
          <a href="/login" style={{ color: C.txT, fontSize: 12, textDecoration: "none" }}>Back to login</a>
        </p>
      </form>
    </div>
  );
}
