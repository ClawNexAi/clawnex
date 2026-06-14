/**
 * ClawNex SSE Broadcaster — Server-Sent Events for real-time dashboard updates.
 *
 * Maintains an in-memory map of connected browser clients. Each client holds
 * a ReadableStreamDefaultController from the /api/events/stream endpoint.
 * When broadcast() is called, the event is serialized as SSE format and
 * enqueued to all connected controllers.
 *
 * Why SSE over WebSocket: Dashboard only receives events (unidirectional).
 * SSE is simpler — no handshake, no ping/pong, automatic browser reconnection
 * via EventSource. WebSocket is only used for the OpenClaw Gateway connection
 * which requires bidirectional challenge-response auth.
 *
 * Events broadcasted: shield.alert, alert.created, correlation.triggered,
 * watcher.update, system.event
 *
 * @module events
 */

type SSEClient = {
  id: string;
  controller: ReadableStreamDefaultController;
  connectedAt: number;
};

/** Maximum number of concurrent SSE connections. Prevents resource exhaustion. */
const MAX_SSE_CLIENTS = 100;

/** In-memory map of connected SSE clients. Cleaned up on broadcast errors. */
const clients = new Map<string, SSEClient>();

/**
 * Register a new SSE client.
 * Called by GET /api/events/stream when a browser connects.
 * Returns null if the connection cap is reached.
 * @param id - Unique client identifier (usually a UUID)
 * @param controller - ReadableStream controller for sending events
 * @returns true if added, null if rejected due to cap
 */
export function addClient(id: string, controller: ReadableStreamDefaultController): true | null {
  if (clients.size >= MAX_SSE_CLIENTS) {
    console.warn(`[SSE] Connection rejected: cap reached (${MAX_SSE_CLIENTS})`);
    return null;
  }
  clients.set(id, { id, controller, connectedAt: Date.now() });
  console.log(`[SSE] Client connected: ${id} (total: ${clients.size})`);
  return true;
}

/**
 * Remove a disconnected SSE client.
 * @param id - Client identifier to remove
 */
export function removeClient(id: string): void {
  clients.delete(id);
  console.log(`[SSE] Client disconnected: ${id} (total: ${clients.size})`);
}

/**
 * Send an event to all connected SSE clients.
 * If a client's controller throws (disconnected), it's automatically removed.
 * @param event - Event name (e.g., "shield.alert", "alert.created")
 * @param data - Event payload (will be JSON-serialized)
 */
export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(payload);

  Array.from(clients.entries()).forEach(([id, client]) => {
    try {
      client.controller.enqueue(bytes);
    } catch {
      // Client disconnected — remove from map
      clients.delete(id);
    }
  });
}

/**
 * Get the number of currently connected SSE clients.
 * Used by the /api/health endpoint to report sseClients count.
 * @returns Number of connected clients
 */
export function getClientCount(): number {
  return clients.size;
}
