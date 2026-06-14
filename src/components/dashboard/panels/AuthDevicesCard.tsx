"use client";

// AUTH & DEVICES — operator settings card.
//
// Per-account self-service for the multi-auth providers shipped in v0.9.0:
//   - Passkeys (live): list, enroll, revoke
//   - GitHub link (live in v0.9.0 once Phase 3 ships): link/unlink — placeholder card today
//   - Magic Link (live in v0.9.2): shows global availability — no per-operator
//     enrollment needed, just requires an email address on the operator record
//
// Local password remains the break-glass identifier — it's not managed
// here. Password change lives in the existing CHANGE PASSWORD card.

import { useCallback, useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { C, F } from "../constants";
import { CollapsibleCard } from "../shared";
import { Tooltip } from "../tooltip";
import { timeAgo } from "../utils";

interface PasskeyRow {
  id: string;
  label: string | null;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

interface GithubStatus {
  enabled: boolean;
  configured: boolean;
  linked: { username: string; linkedAt: string } | null;
}

export function AuthDevicesCard({ focusedCard }: { focusedCard?: string | null }) {
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [magicLinkAvailable, setMagicLinkAvailable] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [pkRes, ghRes, statusRes] = await Promise.all([
        fetch("/api/auth/passkeys"),
        fetch("/api/auth/github/status"),
        fetch("/api/auth/status"),
      ]);
      if (pkRes.ok) {
        const data = await pkRes.json();
        setPasskeys(data.passkeys || []);
      }
      if (ghRes.ok) {
        setGithub(await ghRes.json());
      }
      if (statusRes.ok) {
        const status = await statusRes.json();
        setMagicLinkAvailable(Boolean(status.magicLinkAvailable));
      }
    } catch {
      // Network error — leave list as-is so the user doesn't lose context.
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function unlinkGithub() {
    if (!confirm("Unlink your GitHub account? You'll need to re-link it before you can sign in with GitHub again.")) return;
    try {
      const res = await fetch("/api/auth/github/unlink", { method: "DELETE" });
      if (res.ok) await refresh();
    } catch {
      // ignore
    }
  }

  async function startLinkFlow() {
    // POST to /api/auth/github/link (CSRF-protected) returns { url } —
    // then we navigate to GitHub. Cannot be triggered cross-site since
    // requireSession enforces the X-CSRF-Token check on POST.
    try {
      const res = await fetch("/api/auth/github/link", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Could not start GitHub link.");
        return;
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      alert("Network error starting GitHub link.");
    }
  }

  async function enrollPasskey() {
    setError(null);
    setEnrolling(true);
    try {
      const beginRes = await fetch("/api/auth/passkey/register/begin", { method: "POST" });
      if (!beginRes.ok) {
        setError("Could not start enrollment.");
        setEnrolling(false);
        return;
      }
      const { options } = await beginRes.json();
      const attestation = await startRegistration({ optionsJSON: options });
      const completeRes = await fetch("/api/auth/passkey/register/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation, label: newLabel.trim() || undefined }),
      });
      if (!completeRes.ok) {
        const data = await completeRes.json().catch(() => ({}));
        setError(data.error || "Enrollment failed.");
      } else {
        setNewLabel("");
        await refresh();
      }
    } catch (err) {
      const msg = (err as Error)?.message ?? "";
      setError(msg.includes("NotAllowed") ? "Enrollment cancelled." : "Enrollment failed.");
    }
    setEnrolling(false);
  }

  async function revokePasskey(id: string) {
    if (!confirm("Revoke this passkey? You'll need another way to sign in if it's your only one.")) return;
    try {
      const res = await fetch(`/api/auth/passkeys/${id}`, { method: "DELETE" });
      if (res.ok) await refresh();
    } catch {
      // ignore — refresh on next mount
    }
  }

  return (
    <CollapsibleCard title="AUTH & DEVICES" accent={C.purp} count={passkeys.length} defaultOpen={false} focusKey="authDevices" focusedCard={focusedCard}>
      <div style={{ fontSize: 11, color: C.txT, marginBottom: 10 }}>
        Manage how you sign in to ClawNex. Your password always works as a backup.
      </div>

      {/* Passkeys */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: C.tx, fontWeight: 700, letterSpacing: "0.04em" }}>PASSKEYS</div>
          <button onClick={refresh} style={{ padding: "3px 10px", background: "transparent", border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.txS, fontSize: 10, cursor: "pointer" }}>Refresh</button>
        </div>

        {loading && <div style={{ textAlign: "center", padding: 12, color: C.txT, fontSize: 12 }}>Loading...</div>}
        {!loading && passkeys.length === 0 && (
          <div style={{ textAlign: "center", padding: 16, color: C.txT, fontSize: 12, fontStyle: "italic" }}>No passkeys enrolled yet.</div>
        )}
        {passkeys.map(p => (
          <div key={p.id} style={{ padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderCyan}`, borderRadius: 8, marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: C.tx, fontFamily: F.mono, marginBottom: 4 }}>
                  {p.label || "Unnamed passkey"}
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <span style={{ fontSize: 10, color: C.txS }}>Added: {timeAgo(p.createdAt)}</span>
                  <span style={{ fontSize: 10, color: C.txS }}>Last used: {p.lastUsedAt ? timeAgo(p.lastUsedAt) : "Never"}</span>
                </div>
              </div>
              <Tooltip placement="left" variant="detail" content={<span>Remove this passkey from your account. Effective immediately — anyone holding the matching device key (lost laptop, retired YubiKey) loses sign-in. You can always enroll a new one.</span>}>
                <button onClick={() => revokePasskey(p.id)} style={{ padding: "4px 10px", background: C.danger, color: "#fff", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Revoke</button>
              </Tooltip>
            </div>
          </div>
        ))}

        {/* Enroll */}
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <Tooltip placement="top" variant="compact" content="Friendly name so you can tell your passkeys apart later. e.g. 'MacBook fingerprint', 'YubiKey 5C'.">
            <input
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value.slice(0, 80))}
              placeholder="Label (e.g. MacBook fingerprint)"
              style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.glassBorderSubtle}`, background: C.glassSurfTrans, color: C.tx, fontSize: 12, outline: "none" }}
            />
          </Tooltip>
          <Tooltip placement="top" variant="detail" content={<span>Enroll this device&apos;s WebAuthn credential. Your browser will prompt you to use Touch ID, Face ID, Windows Hello, or a security key. <strong>The private key never leaves your device</strong> — only the public key is sent to ClawNex.</span>}>
            <button
              onClick={enrollPasskey}
              disabled={enrolling}
              style={{ padding: "8px 14px", borderRadius: 6, border: `1px solid ${C.brand}66`, background: "transparent", color: C.brand, fontSize: 12, fontWeight: 700, cursor: enrolling ? "wait" : "pointer", whiteSpace: "nowrap" }}
            >
              {enrolling ? "Waiting..." : "Add Passkey"}
            </button>
          </Tooltip>
        </div>
        {error && (
          <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 6, background: `${C.danger}18`, border: `1px solid ${C.danger}40`, color: C.danger, fontSize: 11 }}>
            {error}
          </div>
        )}
      </div>

      {/* GitHub link */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.glassBorderSubtle}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 12, color: C.tx, fontWeight: 700, letterSpacing: "0.04em" }}>GITHUB</div>
        </div>
        {!github?.enabled && (
          <div style={{ fontSize: 11, color: C.txT }}>
            GitHub sign-in is not enabled. Ask an admin to turn it on in <em>Authentication Methods</em>.
          </div>
        )}
        {github?.enabled && !github.configured && (
          <div style={{ fontSize: 11, color: C.txT }}>
            GitHub sign-in is enabled but credentials are missing. Ask an admin to set the Client ID and Client Secret in <em>Authentication Methods</em>.
          </div>
        )}
        {github?.enabled && github.configured && github.linked && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderCyan}`, borderRadius: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: C.tx, fontFamily: F.mono, marginBottom: 2 }}>@{github.linked.username}</div>
              <div style={{ fontSize: 10, color: C.txS }}>Linked: {timeAgo(github.linked.linkedAt)}</div>
            </div>
            <Tooltip placement="left" variant="detail" content={<span>Disconnect your ClawNex account from this GitHub identity. Your other auth methods (password, passkeys, magic link) keep working. You can re-link the same or a different GitHub account later.</span>}>
              <button onClick={unlinkGithub} style={{ padding: "4px 10px", background: C.danger, color: "#fff", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Unlink</button>
            </Tooltip>
          </div>
        )}
        {github?.enabled && github.configured && !github.linked && (
          <div>
            <div style={{ fontSize: 11, color: C.txT, marginBottom: 8 }}>
              Link a GitHub account to sign in with one click.
            </div>
            <Tooltip placement="top" variant="detail" content={<span>Open the GitHub OAuth consent flow in this window. After you approve, GitHub redirects back here and your account becomes linked. Each ClawNex operator can have <strong>one</strong> GitHub identity at a time.</span>}>
            <button onClick={startLinkFlow} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 6, background: "#0d1117", color: "#fff", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer" }}>
              <svg aria-hidden viewBox="0 0 16 16" width="16" height="16" style={{ display: "block", flexShrink: 0 }}>
                <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              Link GitHub
            </button>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Magic Link — global availability, no per-operator enrollment.
          If the admin has turned Magic Link on AND a mail provider is
          configured, any operator with an email address on file can use
          it. This block surfaces the state without needing a per-account
          on/off — there isn't one. */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.glassBorderSubtle}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 12, color: C.tx, fontWeight: 700, letterSpacing: "0.04em" }}>MAGIC LINK</div>
          <span style={{ fontSize: 9, fontWeight: 700, color: magicLinkAvailable ? C.brand : C.txT, background: magicLinkAvailable ? `${C.brand}18` : `${C.txT}18`, border: `1px solid ${magicLinkAvailable ? C.brand : C.txT}44`, borderRadius: 3, padding: "1px 5px", letterSpacing: "0.05em" }}>
            {magicLinkAvailable ? "LIVE" : "DISABLED"}
          </span>
        </div>
        <div style={{ fontSize: 11, color: C.txT }}>
          {magicLinkAvailable
            ? "Email-delivered one-shot sign-in. Make sure you have an email address on your operator profile — Magic Link sends the link there. Links expire in 15 minutes."
            : "Email-delivered sign-in is not enabled on this instance. Ask an admin to turn it on in Authentication Methods (requires a configured mail provider)."}
        </div>
      </div>
    </CollapsibleCard>
  );
}
