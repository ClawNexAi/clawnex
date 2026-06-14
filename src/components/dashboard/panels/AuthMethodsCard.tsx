"use client";

// AUTHENTICATION METHODS — admin-only configuration card.
//
// Lets an admin enable / disable each auth provider and configure the
// credentials needed to make it work. Settings persist to config_defaults
// (DB), with env values acting as bootstrap fallback. Changes take effect
// on the next request — no restart required.
//
// Provider matrix (v0.9.0):
//   - Local password   — always on (break-glass), no toggle
//   - Passkeys (WebAuthn) — always on, no credentials needed
//   - GitHub OAuth     — admin toggle + Client ID / Secret / Callback URL
//   - Magic Link       — admin toggle (requires a configured mail provider)

import { useCallback, useEffect, useState } from "react";
import { C, F } from "../constants";
import { CollapsibleCard } from "../shared";
import { Tooltip } from "../tooltip";

interface GithubState {
  enabled: boolean;
  clientId: string;
  clientSecret: string;          // Always masked from server; "" sentinel = "no change"
  clientSecretSource: "db" | "env" | "none";
  callbackUrl: string;
}

interface AuthMethodsState {
  passkey: { enabled: boolean; alwaysOn: boolean; note: string };
  github: GithubState;
  magicLink: { enabled: boolean; configured: boolean; available: boolean; note: string };
  local: { enabled: boolean; breakGlass: boolean; note: string };
}

export function AuthMethodsCard({ focusedCard }: { focusedCard?: string | null }) {
  const [state, setState] = useState<AuthMethodsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [mlTesting, setMlTesting] = useState(false);
  const [mlTestMsg, setMlTestMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  // Form-local mirrors of editable fields so the admin can edit before save.
  const [ghEnabled, setGhEnabled] = useState(false);
  const [ghClientId, setGhClientId] = useState("");
  const [ghClientSecret, setGhClientSecret] = useState("");
  const [ghCallbackUrl, setGhCallbackUrl] = useState("");
  const [mlEnabled, setMlEnabled] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/config/auth-methods");
      if (!res.ok) {
        setError("Could not load auth methods config.");
        setLoading(false);
        return;
      }
      const data = (await res.json()) as AuthMethodsState;
      setState(data);
      setGhEnabled(data.github.enabled);
      setGhClientId(data.github.clientId);
      // Server returns the mask placeholder if a secret is stored. Mirror
      // it so the admin sees that something is set without ever receiving
      // the cleartext.
      setGhClientSecret(data.github.clientSecret);
      setGhCallbackUrl(data.github.callbackUrl);
      setMlEnabled(data.magicLink.enabled);
    } catch {
      setError("Network error loading auth methods config.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function sendTestMagicLink() {
    setMlTesting(true);
    setMlTestMsg(null);
    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const csrfToken = csrfRes.ok ? (await csrfRes.json()).token : "";
      const res = await fetch("/api/config/auth-methods/test-magic-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) {
        setMlTestMsg({ tone: "ok", text: data.message || "Test sent." });
      } else {
        setMlTestMsg({
          tone: "err",
          text: data?.message || `Send failed${data?.code ? ` (${data.code})` : ""}.`,
        });
      }
    } catch {
      setMlTestMsg({ tone: "err", text: "Network error sending test." });
    }
    setMlTesting(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      // Only send clientSecret if the admin actually edited it. The mask
      // placeholder coming back from the server is treated as "no change."
      const secretIsMaskOrEmpty = !ghClientSecret || ghClientSecret === state?.github.clientSecret;
      const body = {
        github: {
          enabled: ghEnabled,
          clientId: ghClientId.trim(),
          clientSecret: secretIsMaskOrEmpty ? "" : ghClientSecret,
          callbackUrl: ghCallbackUrl.trim(),
        },
        magicLink: {
          // Hard gate mirror — never persist enabled=true when no mail
          // provider is configured. Belt-and-braces with the disabled
          // checkbox UI; covers the case where state from a prior version
          // still has it enabled when an admin opens the card.
          enabled: mlEnabled && !!state?.magicLink.configured,
        },
      };
      const res = await fetch("/api/config/auth-methods", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Save failed.");
        setSaving(false);
        return;
      }
      setOkMsg("Saved.");
      await refresh();
    } catch {
      setError("Network error saving.");
    }
    setSaving(false);
  }

  return (
    <CollapsibleCard title="AUTHENTICATION METHODS" accent={C.purp} defaultOpen={false} focusKey="authMethods" focusedCard={focusedCard}>
      <div style={{ fontSize: 11, color: C.txT, marginBottom: 12 }}>
        Configure which sign-in methods operators can use. Local password is always on as the break-glass option.
      </div>

      {loading && <div style={{ textAlign: "center", padding: 12, color: C.txT, fontSize: 12 }}>Loading...</div>}

      {state && !loading && (
        <>
          {/* Always-on providers — informational rows */}
          <ProviderRow
            name="Local password"
            badge="ALWAYS ON"
            badgeColor={C.brand}
            note={state.local.note}
          />
          <ProviderRow
            name="Passkeys (WebAuthn)"
            badge="ALWAYS ON"
            badgeColor={C.brand}
            note={state.passkey.note}
          />

          {/* GitHub OAuth — toggle + credentials */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.glassBorderSubtle}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: C.tx, fontWeight: 700, letterSpacing: "0.04em" }}>GITHUB OAUTH</div>
              <Tooltip placement="left" variant="detail" content={<span>Turn the GitHub OAuth provider on or off. When <strong>off</strong>, the &ldquo;Continue with GitHub&rdquo; button is hidden from the login page and any in-flight callback returns an error. Existing operators with linked GitHub accounts can still sign in with password / passkey / magic link.</span>}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11, color: C.txS }}>
                  <input
                    type="checkbox"
                    checked={ghEnabled}
                    onChange={e => setGhEnabled(e.target.checked)}
                    style={{ accentColor: C.brand }}
                  />
                  Enabled
                </label>
              </Tooltip>
            </div>

            <div style={{ fontSize: 11, color: C.txT, marginBottom: 10 }}>
              Operators with linked GitHub accounts can sign in with one click. New GitHub accounts cannot self-register — admin must link them in <em>Auth & Devices</em>.
            </div>

            <FieldLabel>Client ID</FieldLabel>
            <Tooltip placement="top" variant="detail" content={<span>From the GitHub OAuth app you registered (<a href="https://github.com/settings/developers" target="_blank" rel="noopener noreferrer" style={{ color: C.brand }}>github.com/settings/developers</a>). Starts with <strong>Iv1.</strong> — public, safe to commit, but always keep it paired with the secret below.</span>}>
              <input
                type="text"
                value={ghClientId}
                onChange={e => setGhClientId(e.target.value)}
                disabled={!ghEnabled}
                placeholder="Iv1.xxxxxxxxxxxxxxxx"
                style={inputStyle(!ghEnabled)}
              />
            </Tooltip>

            <FieldLabel hint={state.github.clientSecretSource === "env" ? "Set via env var" : state.github.clientSecretSource === "db" ? "Set via UI" : "Not set"}>
              Client Secret
            </FieldLabel>
            <Tooltip placement="top" variant="detail" content={<span>Generated next to the Client ID. <strong>Encrypted at rest.</strong> Never re-displayed after save — leave blank on subsequent edits to keep the existing secret. The hint above the field tells you where the current value comes from (env vs UI).</span>}>
              <input
                type="password"
                value={ghClientSecret}
                onChange={e => setGhClientSecret(e.target.value)}
                disabled={!ghEnabled}
                placeholder={state.github.clientSecretSource === "none" ? "GitHub OAuth app client secret" : "Leave blank to keep current"}
                style={inputStyle(!ghEnabled)}
              />
            </Tooltip>

            <FieldLabel>Callback URL <span style={{ color: C.txT }}>— must match the GitHub app exactly</span></FieldLabel>
            <Tooltip placement="top" variant="detail" content={<span>The full URL GitHub redirects to after the user authorizes. <strong>Must match</strong> the &ldquo;Authorization callback URL&rdquo; field in the GitHub OAuth app exactly — even a trailing-slash mismatch will fail. ClawNex auto-fills this with your public domain.</span>}>
              <input
                type="text"
                value={ghCallbackUrl}
                onChange={e => setGhCallbackUrl(e.target.value)}
                disabled={!ghEnabled}
                placeholder="https://your-host/api/auth/github/callback"
                style={inputStyle(!ghEnabled)}
              />
            </Tooltip>
          </div>

          {/* Magic Link — admin toggle (v0.9.2). Hard-gated on a configured
              mail provider: the checkbox is disabled until Mail Configuration
              has Resend / SMTP / Emailit set up, because flipping the toggle
              without a working provider produces silent failures (begin
              endpoint swallows the error to avoid enumeration). Forcing the
              prerequisite makes the dependency explicit instead of letting
              an admin enable a feature that can't actually deliver mail. */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.glassBorderSubtle}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: C.tx, fontWeight: 700, letterSpacing: "0.04em" }}>MAGIC LINK</div>
              <Tooltip placement="left" variant="detail" content={state.magicLink.configured
                ? <span>Allow operators to sign in by clicking a one-shot link emailed to the address on their account. Magic links expire in 10 min and are single-use. Most teams enable this <em>plus</em> passkeys, leaving local password as break-glass only.</span>
                : <span><strong>Locked</strong> — needs a working mail provider before it can be enabled. Configure Resend, SMTP, or Emailit in the <strong>Mail Configuration</strong> card above, then come back.</span>}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: state.magicLink.configured ? "pointer" : "not-allowed",
                    fontSize: 11,
                    color: state.magicLink.configured ? C.txS : C.txT,
                    opacity: state.magicLink.configured ? 1 : 0.6,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={mlEnabled && state.magicLink.configured}
                    disabled={!state.magicLink.configured}
                    onChange={e => setMlEnabled(e.target.checked)}
                    style={{ accentColor: C.brand }}
                  />
                  Enabled
                </label>
              </Tooltip>
            </div>
            <div style={{ fontSize: 11, color: C.txT, marginBottom: 6 }}>
              Email-delivered one-shot sign-in links. Operators with an email address on file can click &quot;Email me a magic link&quot; on the login page.
            </div>
            <div style={{ fontSize: 11, color: !state.magicLink.configured ? "#fbbf24" : C.txT, fontStyle: !state.magicLink.configured ? "normal" : "italic" }}>
              {!state.magicLink.configured
                ? "🔒 Locked. Configure Resend / SMTP / Emailit in Mail Configuration to unlock this toggle."
                : state.magicLink.note}
            </div>

            {/* Send test — admin can trigger a real magic-link email to
                their own address using the same code path the public
                /begin endpoint uses. Surfaces verbose failure codes that
                /begin must hide for no-enumeration reasons. Only shown
                once Magic Link is actually live. */}
            {state.magicLink.available && (
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Tooltip placement="top" variant="detail" content={<span>Send a real magic-link email to <strong>your</strong> admin address using the same code path the public sign-in flow uses. Verbose failure messages are shown here (the public flow hides them so attackers can&apos;t enumerate accounts) — handy for diagnosing FROM-domain or API-key problems.</span>}>
                  <button
                    type="button"
                    onClick={sendTestMagicLink}
                    disabled={mlTesting}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: `1px solid ${C.brand}66`,
                      background: "transparent",
                      color: C.brand,
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: F.mono,
                      cursor: mlTesting ? "wait" : "pointer",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {mlTesting ? "Sending..." : "SEND TEST"}
                  </button>
                </Tooltip>
                {mlTestMsg && (
                  <span
                    style={{
                      fontSize: 11,
                      color: mlTestMsg.tone === "ok" ? C.brand : C.danger,
                      lineHeight: 1.4,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {mlTestMsg.text}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Save row */}
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
            {error && <span style={{ fontSize: 11, color: C.danger }}>{error}</span>}
            {okMsg && !error && <span style={{ fontSize: 11, color: C.brand }}>{okMsg}</span>}
            <Tooltip placement="top" variant="detail" content={<span>Save all auth-provider settings. Takes effect on the very next sign-in attempt — no restart needed. Encrypted fields (Client Secret) are wiped from the form after save so the cleartext doesn&apos;t linger in the page.</span>}>
              <button
                onClick={save}
                disabled={saving}
                style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: `linear-gradient(135deg, ${C.cyan} 0%, ${C.green} 100%)`, color: "#04070e", fontSize: 12, fontWeight: 700, cursor: saving ? "wait" : "pointer", fontFamily: F.mono }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </Tooltip>
          </div>
        </>
      )}
    </CollapsibleCard>
  );
}

function ProviderRow({ name, badge, badgeColor, note }: { name: string; badge: string; badgeColor: string; note: string }) {
  return (
    <div style={{ padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderCyan}`, borderRadius: 8, marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: C.tx, fontWeight: 600, marginBottom: 2 }}>{name}</div>
        <div style={{ fontSize: 10, color: C.txT }}>{note}</div>
      </div>
      <span style={{ fontSize: 9, fontWeight: 700, color: badgeColor, background: `${badgeColor}18`, border: `1px solid ${badgeColor}44`, borderRadius: 3, padding: "1px 6px", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{badge}</span>
    </div>
  );
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8, marginBottom: 4 }}>
      <label style={{ fontSize: 11, color: C.txS, fontWeight: 600, letterSpacing: "0.03em" }}>{children}</label>
      {hint && <span style={{ fontSize: 10, color: C.txT, fontStyle: "italic" }}>{hint}</span>}
    </div>
  );
}

function inputStyle(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: `1px solid ${C.glassBorderSubtle}`,
    background: disabled ? "rgba(255,255,255,0.01)" : C.glassSurfTrans,
    color: disabled ? C.txT : C.tx,
    fontSize: 12,
    fontFamily: F.mono,
    outline: "none",
    boxSizing: "border-box",
    opacity: disabled ? 0.6 : 1,
  };
}
