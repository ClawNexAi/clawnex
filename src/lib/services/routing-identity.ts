import { createHmac, createHash, randomBytes } from 'node:crypto';

export const ROUTING_IDENTITY_HEADER = 'x-clawnex-routing-identity';
export interface RoutingIdentityOwnership { identityHash?: string; identityContainerExisted?: boolean }

/** This is an instance attestation, not a replacement for proxy access control.
 * The tool holds the signed value; recovery journals hold only its hash.
 */
export function createRoutingIdentity(connector: 'openclaw' | 'hermes' | 'opencode' | 'pi' | 'anythingllm', sourceId: string): { token: string; hash: string } | null {
  const secret = process.env.CLAWNEX_INGEST_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) return null;
  const payload = Buffer.from(JSON.stringify({ v: 1, connector, sourceId, nonce: randomBytes(16).toString('hex') })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`clawnex-routing-v1:${payload}`).digest('base64url');
  const token = `${payload}.${signature}`;
  return { token, hash: routingIdentityHash(token) };
}

export function routingIdentityHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function prepareIdentityHeader(headers: Record<string, unknown>, ownership: RoutingIdentityOwnership,
  connector: 'openclaw' | 'hermes' | 'opencode' | 'pi', sourceId: string): string | null {
  const existingKey = Object.keys(headers).find(key => key.toLowerCase() === ROUTING_IDENTITY_HEADER);
  if (existingKey) {
    const value = headers[existingKey];
    if (!ownership.identityHash || typeof value !== 'string' || routingIdentityHash(value) !== ownership.identityHash) {
      throw new Error('The routing identity header is operator-owned or changed. Its value was preserved.');
    }
    return null;
  }
  if (ownership.identityHash) throw new Error('The routing identity header was removed. Review the instance before changing routing.');
  const identity = createRoutingIdentity(connector, sourceId);
  if (!identity) return null;
  ownership.identityHash = identity.hash;
  return identity.token;
}

export function identityHeaderMatches(headers: Record<string, unknown>, ownership: RoutingIdentityOwnership): boolean {
  if (!ownership.identityHash) return true;
  const key = Object.keys(headers).find(value => value.toLowerCase() === ROUTING_IDENTITY_HEADER);
  const value = key ? headers[key] : undefined;
  return typeof value === 'string' && routingIdentityHash(value) === ownership.identityHash;
}
