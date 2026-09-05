/**
 * FHIR R4 client for the Tebra MCP server.
 *
 * Handles the OAuth2 client_credentials flow for Tebra's FHIR API with either
 * of two client authentications:
 *   - SMART Backend Services private_key_jwt (preferred): an RS384 client
 *     assertion signed with a local private key whose PUBLIC half is published
 *     as a JWKS at the URL registered with Tebra. The key never leaves disk.
 *   - client_secret (legacy fallback): used only when no private key is set.
 * Token caching with automatic refresh. Clean module with no side effects on import.
 *
 * Endpoint notes (verified live 2026-08-03 against production, Smile CDR
 * backend): the base path is /fhir-request (hyphen). Unknown paths on this
 * host return HTTP 200 with an EMPTY body instead of 404, so an empty
 * response body is treated as a configuration error here — otherwise the
 * only symptom is an opaque JSON parse failure.
 *
 * Environment variables (all optional — FHIR tools only register when configured):
 *   TEBRA_FHIR_CLIENT_ID         — OAuth2 client ID from Tebra FHIR registration
 *   TEBRA_FHIR_PRIVATE_KEY_PATH  — PEM (PKCS#8) private key for private_key_jwt; with it,
 *                                   TEBRA_FHIR_KID is required (the JWKS `kid` of the public half)
 *   TEBRA_FHIR_CLIENT_SECRET     — OAuth2 client secret (fallback when no key path is set)
 *   TEBRA_FHIR_BASE_URL      — FHIR API base URL (default: Tebra production)
 *   TEBRA_FHIR_TOKEN_URL     — OAuth2 token endpoint (default: Tebra production)
 */

import { createPrivateKey, randomBytes, sign as cryptoSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface FhirPrivateKey {
  /** PEM-encoded private key (PKCS#8). Never logged, never sent — it only signs. */
  pem: string;
  /** JWKS key id of the matching public key, so the server can pick it from the set. */
  kid: string;
}

export interface FhirConfig {
  clientId: string;
  /** Legacy client_secret auth. Ignored when `privateKey` is present. */
  clientSecret?: string;
  /** SMART Backend Services private_key_jwt auth. Takes precedence over `clientSecret`. */
  privateKey?: FhirPrivateKey;
  baseUrl: string;
  tokenUrl: string;
}

export const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
// SMART Backend Services: exp MUST be no more than 5 minutes after issue.
const ASSERTION_LIFETIME_S = 300;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface ClientAssertionInput {
  clientId: string;
  /** The token endpoint — the assertion's audience is the URL it is sent to. */
  tokenUrl: string;
  privateKeyPem: string;
  kid: string;
  /** Unix seconds; defaults to now. Injectable for deterministic tests. */
  now?: number;
}

/**
 * Build the RS384 client assertion for SMART Backend Services
 * (HL7 Bulk Data Access / SMART App Launch "Backend Services", RFC 7523):
 * header {alg, typ, kid}; claims iss = sub = client id, aud = token URL,
 * exp = iat + 5 minutes, and a unique jti per assertion (servers may reject
 * a replayed jti).
 */
export function buildClientAssertion(input: ClientAssertionInput): string {
  const iat = input.now ?? Math.floor(Date.now() / 1000);
  const header = { alg: 'RS384', typ: 'JWT', kid: input.kid };
  const claims = {
    iss: input.clientId,
    sub: input.clientId,
    aud: input.tokenUrl,
    iat,
    exp: iat + ASSERTION_LIFETIME_S,
    jti: randomBytes(24).toString('base64url'),
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = createPrivateKey(input.privateKeyPem);
  const signature = cryptoSign('sha384', Buffer.from(signingInput), key);
  return `${signingInput}.${b64url(signature)}`;
}

const REQUEST_TIMEOUT_MS = 30_000;

// Upstream response bodies are truncated before entering error messages —
// they can be large and, on a PHI-bearing API, do not belong in transcripts
// verbatim.
function truncateBody(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}… [truncated]` : text;
}

// Token cache
let cachedToken: { accessToken: string; expiresAt: number } | null = null;
// Once a scope is known to work (or the server tells us the registered one),
// stick with it for subsequent refreshes.
let resolvedScope: string | null = null;

function tokenRequestBody(config: FhirConfig, scope: string): URLSearchParams {
  if (config.privateKey) {
    // A fresh assertion per request: each carries its own jti and a 5-minute exp.
    return new URLSearchParams({
      grant_type: 'client_credentials',
      client_assertion_type: CLIENT_ASSERTION_TYPE,
      client_assertion: buildClientAssertion({
        clientId: config.clientId,
        tokenUrl: config.tokenUrl,
        privateKeyPem: config.privateKey.pem,
        kid: config.privateKey.kid,
      }),
      scope,
    });
  }
  if (config.clientSecret === undefined) {
    throw new Error('FHIR config has neither a private key nor a client secret — nothing to authenticate the token request with.');
  }
  return new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope,
  });
}

async function requestToken(config: FhirConfig, scope: string): Promise<Response> {
  return fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenRequestBody(config, scope),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function getAccessToken(config: FhirConfig): Promise<string> {
  // Check cache (with 60s buffer before expiry)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.accessToken;
  }

  // Tebra scopes are whatever was registered in appSphere; override via
  // TEBRA_FHIR_SCOPE if the registration used something narrower.
  let scope = resolvedScope ?? process.env.TEBRA_FHIR_SCOPE?.trim() ?? 'system/*.read';
  let response = await requestToken(config, scope);

  if (!response.ok) {
    let text = await response.text();
    // On invalid_scope, Smile CDR's error body names the scope the client is
    // actually registered with (verified live 2026-08-03) — retry with it.
    try {
      const err = JSON.parse(text) as { error?: string; scope?: string };
      if (err.error === 'invalid_scope' && err.scope && err.scope !== scope) {
        scope = err.scope;
        response = await requestToken(config, scope);
        if (!response.ok) text = await response.text();
      }
    } catch { /* non-JSON error body — fall through */ }

    if (!response.ok) {
      throw new Error(
        `FHIR token request failed (${response.status}): ${truncateBody(text)}. ` +
        'Note: both the practice and the backend-service client must be activated by Tebra Customer Care before tokens are issued.'
      );
    }
  }

  resolvedScope = scope;
  const data = await response.json() as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

async function fhirGet(config: FhirConfig, url: string): Promise<unknown> {
  let token = await getAccessToken(config);

  let response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/fhir+json',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  // On 401, clear the cached token and retry once with a fresh one.
  if (response.status === 401) {
    cachedToken = null;
    token = await getAccessToken(config);
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/fhir+json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`FHIR request failed (${response.status}) for ${url}: ${truncateBody(text)}`);
  }

  const text = await response.text();
  if (!text) {
    // Tebra's gateway returns 200-empty (not 404) for unknown paths.
    throw new Error(
      `FHIR request to ${url} returned an empty 200 response — this almost always means the base URL path is wrong. ` +
      `Expected base: https://fhir.prd.cloud.tebra.com/fhir-request (note the hyphen). Current base: ${config.baseUrl}`
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`FHIR request to ${url} returned non-JSON content: ${truncateBody(text, 200)}`);
  }
}

export async function fhirRequest(
  config: FhirConfig,
  resource: string,
  params?: Record<string, string | string[]>,
): Promise<unknown> {
  const url = new URL(`${config.baseUrl}/${resource}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      // Arrays become repeated query params (e.g. date=ge2026-01-01&date=le2026-02-01).
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, item);
      } else {
        url.searchParams.set(k, v);
      }
    }
  }
  return fhirGet(config, url.toString());
}

/** Fetch an absolute FHIR URL (used to follow Bundle paging links). */
export async function fhirRequestUrl(config: FhirConfig, url: string): Promise<unknown> {
  return fhirGet(config, url);
}

export function isFhirConfigured(): boolean {
  return !!(
    process.env.TEBRA_FHIR_CLIENT_ID &&
    (process.env.TEBRA_FHIR_PRIVATE_KEY_PATH || process.env.TEBRA_FHIR_CLIENT_SECRET)
  );
}

function loadPrivateKey(): FhirPrivateKey | undefined {
  const path = process.env.TEBRA_FHIR_PRIVATE_KEY_PATH?.trim();
  if (!path) return undefined;
  const kid = process.env.TEBRA_FHIR_KID?.trim();
  if (!kid) {
    throw new Error(
      'TEBRA_FHIR_PRIVATE_KEY_PATH is set but TEBRA_FHIR_KID is not. ' +
      'The kid must match the key id in the JWKS registered with Tebra, or the server cannot select the public key to verify the assertion.'
    );
  }
  let pem: string;
  try {
    pem = readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read the FHIR private key at TEBRA_FHIR_PRIVATE_KEY_PATH=${path}: ${reason}`);
  }
  try {
    createPrivateKey(pem);
  } catch {
    throw new Error(`The file at TEBRA_FHIR_PRIVATE_KEY_PATH=${path} is not a PEM-encoded private key.`);
  }
  return { pem, kid };
}

export function getFhirConfig(): FhirConfig {
  const clientId = process.env.TEBRA_FHIR_CLIENT_ID;
  if (!clientId) {
    throw new Error('FHIR credentials not configured. Set TEBRA_FHIR_CLIENT_ID plus either TEBRA_FHIR_PRIVATE_KEY_PATH (+ TEBRA_FHIR_KID) or TEBRA_FHIR_CLIENT_SECRET.');
  }
  const privateKey = loadPrivateKey();
  const clientSecret = privateKey ? undefined : process.env.TEBRA_FHIR_CLIENT_SECRET;
  if (!privateKey && !clientSecret) {
    throw new Error('FHIR credentials not configured. Set TEBRA_FHIR_PRIVATE_KEY_PATH (+ TEBRA_FHIR_KID) or TEBRA_FHIR_CLIENT_SECRET.');
  }

  return {
    clientId,
    ...(privateKey ? { privateKey } : { clientSecret }),
    // Live-verified 2026-08-03: the path segment is fhir-request (hyphen).
    baseUrl: process.env.TEBRA_FHIR_BASE_URL?.trim() ?? 'https://fhir.prd.cloud.tebra.com/fhir-request',
    tokenUrl: process.env.TEBRA_FHIR_TOKEN_URL?.trim() ?? 'https://fhir.prd.cloud.tebra.com/smartauth/oauth/token',
  };
}
