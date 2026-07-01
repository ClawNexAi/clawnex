/**
 * ClawNex OpenClaw Gateway Connector — READ-ONLY WebSocket client.
 *
 * Connects to the OpenClaw Gateway via WebSocket, authenticates using
 * the challenge-response handshake (protocol v3-v4), and subscribes to
 * real-time events (agent, chat, system). Provides RPC wrappers for
 * querying sessions, agents, models, and config.
 *
 * This is a singleton — one connection is shared across all API routes.
 * Gracefully degrades when the gateway is unreachable.
 *
 * Authentication flow:
 * 1. Connect to ws://127.0.0.1:18789/?token=***
 * 2. Gateway sends a "connect.challenge" event with `payload.nonce` (4.12+)
 *    or with no payload (3.28 and earlier).
 * 3. If nonce present: connector loads/generates an Ed25519 keypair, signs
 *    the V2 device-auth payload (deviceId|clientId|...|nonce), and includes
 *    `device: { id, publicKey, signature, signedAtMs }` in the connect frame
 *    alongside the legacy `auth.token`. Gateway silent-pairs loopback clients
 *    on first such handshake.
 *    If nonce absent (older gateways): connector sends only `auth.token` —
 *    legacy path stays intact.
 * 4. Gateway validates and replies with the connect response.
 * 5. Connector subscribes to event streams.
 *
 * Token resolution (fallback chain):
 * 1. OPENCLAW_GATEWAY_TOKEN env var
 * 2. config_defaults table (key: "openclaw_gateway_token")
 * 3. config_gateways table (primary gateway's token field)
 *
 * Why WebSocket here (not SSE): The OpenClaw Gateway requires bidirectional
 * communication for the challenge-response auth protocol. SSE is unidirectional
 * and couldn't support this handshake.
 *
 * @module connectors/openclaw-connector
 */

import WebSocket from 'ws';
import { randomUUID, createHash, generateKeyPairSync, sign as cryptoSign, createPublicKey } from 'node:crypto';
import { config } from '../config';
import { broadcast } from '../events';
import { run } from '../db';
import { shieldScan } from '../shield/scanner';
import { sanitizeLogField } from '../security/log-sanitize';

// ---------------------------------------------------------------------------
// Device Identity (OpenClaw 4.12+ silent-local-pairing handshake)
// ---------------------------------------------------------------------------
//
// OpenClaw 2026.4.x added a `device` field to the connect-frame protocol that
// the gateway uses to silent-pair loopback clients on first contact. The frame
// requires Ed25519 deviceId+publicKey+signature over a pipe-delimited payload
// that includes the nonce the gateway sends in the connect.challenge event.
//
// We persist the keypair in `config_defaults` (PEM-encoded) so it survives
// dashboard restarts and clean redeploys. deviceId is the SHA-256 hex of the
// raw 32-byte public key — matches OpenClaw's own derivation in
// `device-identity-DcDwQX3R.js → fingerprintPublicKey`.
//
// **Backwards-compat with OpenClaw <4.x**: older gateways send connect.challenge
// with NO `nonce` field. handleIncoming guards on `data.payload?.nonce` and
// skips the device fields entirely when it's missing — the legacy `?token=`
// path stays intact.

interface DeviceIdentity {
  deviceId: string;        // 64 hex chars: sha256(rawPubkey).hex()
  publicKeyPem: string;    // SPKI PEM (for crypto.createPublicKey)
  privateKeyPem: string;   // PKCS8 PEM (for crypto.createPrivateKey)
  publicKeyB64Url: string; // base64url-encoded raw 32 bytes (wire format)
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function rawPubkeyFromPem(publicKeyPem: string): Buffer {
  const spki = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function loadOrCreateDeviceIdentity(): DeviceIdentity {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const db = require('@/lib/db/index');
  let pubPem: string | undefined;
  let privPem: string | undefined;
  try {
    pubPem = db.queryOne(
      "SELECT value FROM config_defaults WHERE key = 'clawnex_device_public_key_pem'",
    )?.value;
    privPem = db.queryOne(
      "SELECT value FROM config_defaults WHERE key = 'clawnex_device_private_key_pem'",
    )?.value;
  } catch {
    /* table may not yet have rows; fall through to generation */
  }

  if (!pubPem || !privPem) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    try {
      run(
        "INSERT OR REPLACE INTO config_defaults (key, value) VALUES (?, ?)",
        ['clawnex_device_public_key_pem', pubPem],
      );
      run(
        "INSERT OR REPLACE INTO config_defaults (key, value) VALUES (?, ?)",
        ['clawnex_device_private_key_pem', privPem],
      );
      console.log('[ClawNex/OpenClaw] Generated new Ed25519 device identity');
    } catch (err) {
      console.warn(
        '[ClawNex/OpenClaw] Could not persist device identity to DB; will regenerate next start:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  const rawPub = rawPubkeyFromPem(pubPem);
  return {
    deviceId: createHash('sha256').update(rawPub).digest('hex'),
    publicKeyPem: pubPem,
    privateKeyPem: privPem,
    publicKeyB64Url: base64UrlEncode(rawPub),
  };
}

/**
 * Build the V2 device-auth payload string the gateway will hash for verification.
 * Format (pipe-delimited):
 *   v2|deviceId|clientId|clientMode|role|scopes-comma-joined|signedAtMs|token|nonce
 *
 * Kept in lockstep with `buildDeviceAuthPayload` in OpenClaw's
 * `client-C7CdT-9h.js` (mirror — DO NOT change format unless OpenClaw does).
 * V2 is the safer choice over V3 because V3's platform/deviceFamily inputs
 * require the same `normalizeDeviceMetadataForAuth` normalizer the gateway uses;
 * the gateway falls back to V2 verification when V3 fails, so V2-only is
 * sufficient and avoids a normalizer drift trap.
 */
function buildDeviceAuthPayloadV2(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: readonly string[];
  signedAtMs: number;
  token: string;
  nonce: string;
}): string {
  return [
    'v2',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(','),
    String(params.signedAtMs),
    params.token,
    params.nonce,
  ].join('|');
}

function signPayload(privateKeyPem: string, payload: string): string {
  return base64UrlEncode(cryptoSign(null, Buffer.from(payload, 'utf8'), privateKeyPem));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface OpenClawAgent {
  id: string;
  name?: string;
  status?: string;
  model?: string;
  [key: string]: unknown;
}

export interface OpenClawSession {
  id: string;
  channel?: string;
  peer?: string;
  agentId?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface OpenClawModel {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
}

export interface OpenClawConfigSnapshot {
  config?: {
    agents?: {
      defaults?: {
        model?: {
          primary?: string;
        };
      };
    };
  };
}

export interface ConnectionStatus {
  connected: boolean;
  authenticated: boolean;
  lastEvent: string | null;
  lastError: string | null;
  reconnectAttempts: number;
  sessions: number;
  agents: number;
}

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

const RPC_TIMEOUT_MS = 30_000;
const INITIAL_RECONNECT_MS = 2_000;
const MAX_RECONNECT_MS = 60_000;
const CONNECTION_TIMEOUT_MS = 10_000;

class OpenClawConnector {
  private ws: WebSocket | null = null;
  private connected = false;
  private authenticated = false;
  private connecting: Promise<void> | null = null;
  private autoReconnect = true;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = INITIAL_RECONNECT_MS;
  private reconnectAttempts = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private lastEvent: string | null = null;
  private lastError: string | null = null;

  // Cached counts (updated on RPC calls and events)
  private cachedSessionCount = 0;
  private cachedAgentCount = 0;

  // Metrics snapshot interval
  private metricsTimer: NodeJS.Timeout | null = null;
  private readonly METRICS_INTERVAL_MS = 60_000; // 1 minute

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this._doConnect();
    return this.connecting;
  }

  private _doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.cleanup();

        const wsUrl = new URL(config.openclaw.url);
        // Token priority: env var > database config > empty
        let resolvedToken = config.openclaw.token;
        if (!resolvedToken) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const db = require("@/lib/db/index");
            const dbToken = db.queryOne("SELECT value FROM config_defaults WHERE key = 'openclaw_gateway_token'");
            if (dbToken?.value) resolvedToken = dbToken.value;
          } catch {}
          if (!resolvedToken) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const db = require("@/lib/db/index");
              const gwToken = db.queryOne("SELECT token FROM config_gateways WHERE is_primary = 1 AND token != ''");
              if (gwToken?.token) resolvedToken = gwToken.token;
            } catch {}
          }
        }
        // Store for use in auth frame later
        (this as unknown as { _resolvedToken: string })._resolvedToken = resolvedToken || "";
        if (resolvedToken) {
          wsUrl.searchParams.set('token', resolvedToken);
        }

        console.log('[ClawNex/OpenClaw] Connecting to:', wsUrl.toString().replace(/token=[^&]+/, 'token=***'));

        this.ws = new WebSocket(wsUrl.toString());

        const connectionTimeout = setTimeout(() => {
          if (!this.connected) {
            console.error('[ClawNex/OpenClaw] Connection timeout');
            this.ws?.close();
            this.connecting = null;
            reject(new Error('Connection timeout'));
          }
        }, CONNECTION_TIMEOUT_MS);

        this.ws.on('open', () => {
          console.log('[ClawNex/OpenClaw] WebSocket opened, waiting for challenge...');
        });

        this.ws.on('message', (raw: WebSocket.Data) => {
          try {
            const data = JSON.parse(raw.toString());
            this.handleIncoming(data, resolve, reject, connectionTimeout);
          } catch (err) {
            console.error('[ClawNex/OpenClaw] Failed to parse message:', err);
          }
        });

        this.ws.on('close', (code, reason) => {
          clearTimeout(connectionTimeout);
          const wasConnected = this.connected;
          this.connected = false;
          this.authenticated = false;
          this.connecting = null;

          console.log(`[ClawNex/OpenClaw] Disconnected (code: ${code}, reason: "${reason?.toString()}")`);

          // Reject all pending RPC calls
          Array.from(this.pendingRequests.entries()).forEach(([id, pending]) => {
            clearTimeout(pending.timer);
            pending.reject(new Error('Connection closed'));
            this.pendingRequests.delete(id);
          });

          if (this.autoReconnect && wasConnected) {
            this.scheduleReconnect();
          } else if (this.autoReconnect && !wasConnected) {
            // Initial connection failed — still try to reconnect
            this.scheduleReconnect();
          }
        });

        this.ws.on('error', (err) => {
          clearTimeout(connectionTimeout);
          this.lastError = err.message || 'WebSocket error';
          console.error('[ClawNex/OpenClaw] WebSocket error:', this.lastError);

          if (!this.connected) {
            this.connecting = null;
            reject(new Error(`Failed to connect: ${this.lastError}`));
          }
        });
      } catch (err) {
        this.connecting = null;
        reject(err);
      }
    });
  }

  private handleIncoming(
    data: Record<string, unknown>,
    connectResolve: () => void,
    connectReject: (err: Error) => void,
    connectionTimeout: NodeJS.Timeout,
  ): void {
    // Handle challenge-response handshake
    if (data.type === 'event' && data.event === 'connect.challenge') {
      console.log('[ClawNex/OpenClaw] Challenge received, responding...');
      clearTimeout(connectionTimeout);

      const requestId = randomUUID();
      const resolvedToken =
        (this as unknown as { _resolvedToken: string })._resolvedToken || config.openclaw.token || '';

      // Backwards-compat: OpenClaw <4.x sends `connect.challenge` with no
      // `payload.nonce`. In that case we omit the device field and rely on
      // the legacy `?token=` URL param + `auth.token` only — which is what
      // 3.28 expects. OpenClaw 4.12+ requires the device fields and rejects
      // with `device identity required` if they're missing.
      const challengePayload = (data.payload as { nonce?: string; ts?: number } | undefined) ?? {};
      const nonce = typeof challengePayload.nonce === 'string' ? challengePayload.nonce : null;

      const clientId = 'gateway-client';
      const clientMode = 'backend';
      const role = 'operator';
      const scopes = ['operator.read', 'operator.write'] as const;

      // Device field shape per OpenClaw 4.12+ connect-params schema:
      //   { id, publicKey, signature, signedAt, nonce }
      // Internally the gateway maps `signedAt` → `signedAtMs` and `nonce` →
      // `nonce` when rebuilding the signed payload for verification, but the
      // wire schema validator (validateConnectParams) requires both fields
      // present on the device object itself or it rejects with
      // `must have required property 'signedAt'/'nonce'`.
      let deviceField:
        | { id: string; publicKey: string; signature: string; signedAt: number; nonce: string }
        | undefined;
      if (nonce) {
        try {
          const identity = loadOrCreateDeviceIdentity();
          const signedAt = Date.now();
          const payload = buildDeviceAuthPayloadV2({
            deviceId: identity.deviceId,
            clientId,
            clientMode,
            role,
            scopes,
            signedAtMs: signedAt,
            token: resolvedToken,
            nonce,
          });
          deviceField = {
            id: identity.deviceId,
            publicKey: identity.publicKeyB64Url,
            signature: signPayload(identity.privateKeyPem, payload),
            signedAt,
            nonce,
          };
        } catch (err) {
          console.warn(
            '[ClawNex/OpenClaw] Device-identity handshake failed; falling back to legacy token-only:',
            err instanceof Error ? err.message : err,
          );
        }
      }

      const connectFrame = {
        type: 'req',
        id: requestId,
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 4,
          client: {
            id: clientId,
            version: '0.4.4',
            platform: process.platform || 'node',
            mode: clientMode,
          },
          role,
          scopes,
          caps: [],
          auth: {
            token: resolvedToken,
          },
          // Only set when the gateway sent a nonce (4.12+). 3.28 ignores
          // unknown keys but we'd rather not include `undefined` either.
          ...(deviceField ? { device: deviceField } : {}),
        },
      };

      // Register pending request for the connect response
      this.pendingRequests.set(requestId, {
        resolve: () => {
          this.connected = true;
          this.authenticated = true;
          this.connecting = null;
          this.reconnectDelay = INITIAL_RECONNECT_MS;
          this.reconnectAttempts = 0;
          this.lastEvent = new Date().toISOString();
          this.lastError = null;

          console.log('[ClawNex/OpenClaw] Authenticated successfully');
          this.startMetricsTimer();
          this.logAudit('openclaw_connected', 'gateway', 'openclaw', 'Connected to OpenClaw Gateway');
          broadcast('openclaw:status', { connected: true });
          connectResolve();
        },
        reject: (error: Error) => {
          this.connecting = null;
          this.lastError = error.message;
          this.ws?.close();
          connectReject(new Error(`Authentication failed: ${error.message}`));
        },
        timer: setTimeout(() => {
          this.pendingRequests.delete(requestId);
          this.connecting = null;
          this.lastError = 'Auth response timeout';
          this.ws?.close();
          connectReject(new Error('Authentication response timeout'));
        }, RPC_TIMEOUT_MS),
      });

      this.ws!.send(JSON.stringify(connectFrame));
      return;
    }

    // Handle RPC responses
    if (data.type === 'res' && data.id !== undefined) {
      const pending = this.pendingRequests.get(data.id as string);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(data.id as string);

        if (data.ok === false && data.error) {
          const errObj = data.error as Record<string, unknown>;
          pending.reject(new Error((errObj.message as string) || 'RPC error'));
        } else {
          pending.resolve(data.payload);
        }
        return;
      }
    }

    // Handle events
    if (data.type === 'event') {
      this.lastEvent = new Date().toISOString();

      const eventType = data.event as string;
      const payload = data.payload as Record<string, unknown> | undefined;

      // Forward to SSE
      if (eventType === 'agent' && payload) {
        broadcast('agent_event', payload);
        this.logAudit('agent_event', 'agent', 'openclaw', sanitizeLogField(JSON.stringify(payload), 500));
      }

      if (eventType === 'chat' && payload) {
        broadcast('chat_event', payload);
        this.logAudit('chat_event', 'chat', 'openclaw', sanitizeLogField(JSON.stringify(payload), 500));

        // Run chat content through prompt shield
        const content = (payload.content as string) || (payload.message as string) || '';
        if (content) {
          try {
            const result = shieldScan(content);
            if (result.verdict !== 'ALLOW') {
              broadcast('shield_alert', {
                sessionId: payload.sessionId || payload.session_id,
                verdict: result.verdict,
                score: result.score,
                detections: result.detections.length,
                timestamp: new Date().toISOString(),
              });
              console.log("[ClawNex/OpenClaw] Shield verdict", {
                verdict: result.verdict,
                score: result.score,
                detections: result.detections.length,
              });
            }
          } catch (err) {
            console.error('[ClawNex/OpenClaw] Shield scan error:', err);
          }
        }
      }

      if (eventType === 'system' && payload) {
        broadcast('system_event', payload);
        this.logAudit('system_event', 'system', 'openclaw', sanitizeLogField(JSON.stringify(payload), 500));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Reconnection
  // -------------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.autoReconnect) return;

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), MAX_RECONNECT_MS);

    console.log(`[ClawNex/OpenClaw] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.autoReconnect) return;

      try {
        await this.connect();
      } catch {
        // connect() failure will trigger onclose which calls scheduleReconnect again
      }
    }, delay);
  }

  // -------------------------------------------------------------------------
  // RPC
  // -------------------------------------------------------------------------

  async rpc<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws || !this.connected || !this.authenticated) {
      throw new Error('Not connected to OpenClaw Gateway');
    }

    const id = randomUUID();
    const frame = { type: 'req', id, method, params: params || {} };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, RPC_TIMEOUT_MS);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      this.ws!.send(JSON.stringify(frame));
    });
  }

  // -------------------------------------------------------------------------
  // RPC Wrappers
  // -------------------------------------------------------------------------

  async listSessions(): Promise<OpenClawSession[]> {
    try {
      const result = await this.rpc<Record<string, unknown>>('sessions.list');
      if (result && Array.isArray(result)) return result as OpenClawSession[];
      if (result && typeof result === 'object' && Array.isArray((result as Record<string, unknown>).sessions)) {
        const sessions = (result as Record<string, unknown>).sessions as OpenClawSession[];
        this.cachedSessionCount = sessions.length;
        return sessions;
      }
      // If result is something else, try to extract an array
      if (result && typeof result === 'object') {
        // Gateway might return a different structure — handle gracefully
        const vals = Object.values(result);
        const arrVal = vals.find(v => Array.isArray(v));
        if (arrVal) {
          this.cachedSessionCount = (arrVal as unknown[]).length;
          return arrVal as OpenClawSession[];
        }
      }
      return [];
    } catch (err) {
      console.error('[ClawNex/OpenClaw] listSessions error:', err);
      return [];
    }
  }

  async listAgents(): Promise<OpenClawAgent[]> {
    try {
      const result = await this.rpc<Record<string, unknown>>('agents.list');
      // Gateway returns { requester, allowAny, agents: [...] }
      if (result && typeof result === 'object' && Array.isArray((result as Record<string, unknown>).agents)) {
        const agents = (result as Record<string, unknown>).agents as OpenClawAgent[];
        this.cachedAgentCount = agents.length;
        return agents;
      }
      if (Array.isArray(result)) {
        this.cachedAgentCount = (result as unknown[]).length;
        return result as OpenClawAgent[];
      }
      return [];
    } catch (err) {
      console.error('[ClawNex/OpenClaw] listAgents error:', err);
      return [];
    }
  }

  async listModels(): Promise<OpenClawModel[]> {
    try {
      const result = await this.rpc<Record<string, unknown>>('models.list');
      if (result && typeof result === 'object' && Array.isArray((result as Record<string, unknown>).models)) {
        return (result as Record<string, unknown>).models as OpenClawModel[];
      }
      if (Array.isArray(result)) {
        return result as OpenClawModel[];
      }
      return [];
    } catch (err) {
      console.error('[ClawNex/OpenClaw] listModels error:', err);
      return [];
    }
  }

  async getConfig(key?: string): Promise<OpenClawConfigSnapshot> {
    try {
      const params = key ? { key } : {};
      const result = await this.rpc<unknown>('config.get', params);
      if (result && typeof result === 'object') {
        return result as OpenClawConfigSnapshot;
      }
      return {};
    } catch (err) {
      console.error('[ClawNex/OpenClaw] getConfig error:', err);
      return {};
    }
  }

  async getStatus(): Promise<Record<string, unknown>> {
    try {
      return await this.rpc<Record<string, unknown>>('status.get');
    } catch (err) {
      console.error('[ClawNex/OpenClaw] getStatus error:', err);
      return {};
    }
  }

  // -------------------------------------------------------------------------
  // Status & Lifecycle
  // -------------------------------------------------------------------------

  getConnectionStatus(): ConnectionStatus {
    return {
      connected: this.connected && this.authenticated,
      authenticated: this.authenticated,
      lastEvent: this.lastEvent,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts,
      sessions: this.cachedSessionCount,
      agents: this.cachedAgentCount,
    };
  }

  isConnected(): boolean {
    return this.connected && this.authenticated && this.ws?.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    this.autoReconnect = false;
    this.stopMetricsTimer();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.cleanup();
    console.log('[ClawNex/OpenClaw] Disconnected intentionally');
  }

  private cleanup(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;

    // Reject pending requests
    Array.from(this.pendingRequests.entries()).forEach(([, pending]) => {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection reset'));
    });
    this.pendingRequests.clear();
  }

  // -------------------------------------------------------------------------
  // Metrics timer
  // -------------------------------------------------------------------------

  private startMetricsTimer(): void {
    this.stopMetricsTimer();
    this.metricsTimer = setInterval(async () => {
      if (!this.isConnected()) return;
      try {
        const [sessions, agents] = await Promise.allSettled([
          this.listSessions(),
          this.listAgents(),
        ]);
        const sessionCount = sessions.status === 'fulfilled' ? sessions.value.length : this.cachedSessionCount;
        const agentCount = agents.status === 'fulfilled' ? agents.value.length : this.cachedAgentCount;

        this.cachedSessionCount = sessionCount;
        this.cachedAgentCount = agentCount;

        // Store metric snapshots
        const now = new Date().toISOString();
        try {
          run(
            'INSERT INTO metric_snapshots (source, metric_name, metric_value, metadata, recorded_at) VALUES (?, ?, ?, ?, ?)',
            ['openclaw', 'session_count', sessionCount, null, now],
          );
          run(
            'INSERT INTO metric_snapshots (source, metric_name, metric_value, metadata, recorded_at) VALUES (?, ?, ?, ?, ?)',
            ['openclaw', 'agent_count', agentCount, null, now],
          );
        } catch (dbErr) {
          console.error('[ClawNex/OpenClaw] Metrics DB write error:', dbErr);
        }
      } catch (err) {
        console.error('[ClawNex/OpenClaw] Metrics poll error:', err);
      }
    }, this.METRICS_INTERVAL_MS);
  }

  private stopMetricsTimer(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Audit helper
  // -------------------------------------------------------------------------

  private logAudit(action: string, resourceType: string, source: string, detail?: string): void {
    try {
      run(
        'INSERT INTO audit_log (id, actor, action, resource_type, source, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), 'clawnex', action, resourceType, source, detail || null, new Date().toISOString()],
      );
    } catch {
      // Silently ignore audit write failures
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: OpenClawConnector | null = null;

/**
 * Returns the singleton OpenClaw connector, initializing lazily on first call.
 * Starts connecting in the background — callers should check isConnected()
 * before making RPC calls and handle graceful degradation.
 */
export function getOpenClawConnector(): OpenClawConnector {
  if (!instance) {
    instance = new OpenClawConnector();

    // Start connecting in the background (don't await — lazy init)
    instance.connect().catch((err) => {
      console.warn('[ClawNex/OpenClaw] Initial connection failed (will retry):', err.message);
    });
  }
  return instance;
}

/**
 * Ensure the connector is connected, with a short wait.
 * Returns the connector regardless (for graceful degradation).
 */
export async function ensureConnected(): Promise<OpenClawConnector> {
  const connector = getOpenClawConnector();
  if (!connector.isConnected()) {
    try {
      await Promise.race([
        connector.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('connect timeout')), 5000)),
      ]);
    } catch {
      // Graceful degradation — return connector anyway
    }
  }
  return connector;
}
