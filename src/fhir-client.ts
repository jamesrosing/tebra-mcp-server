/**
 * FHIR R4 client for the Tebra MCP server.
 *
 * Handles OAuth2 client_credentials flow for Tebra's FHIR API.
 * Token caching with automatic refresh. Clean module with no side effects on import.
 *
 * Endpoint notes (verified live 2026-08-03 against production, Smile CDR
 * backend): the base path is /fhir-request (hyphen). Unknown paths on this
 * host return HTTP 200 with an EMPTY body instead of 404, so an empty
 * response body is treated as a configuration error here — otherwise the
 * only symptom is an opaque JSON parse failure.
 *
 * Environment variables (all optional — FHIR tools only register when configured):
 *   TEBRA_FHIR_CLIENT_ID     — OAuth2 client ID from Tebra FHIR registration
 *   TEBRA_FHIR_CLIENT_SECRET — OAuth2 client secret
 *   TEBRA_FHIR_BASE_URL      — FHIR API base URL (default: Tebra production)
 *   TEBRA_FHIR_TOKEN_URL     — OAuth2 token endpoint (default: Tebra production)
 */

export interface FhirConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  tokenUrl: string;
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

async function getAccessToken(config: FhirConfig): Promise<string> {
  // Check cache (with 60s buffer before expiry)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.accessToken;
  }

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      // Tebra scopes are whatever was registered in appSphere; override via
      // TEBRA_FHIR_SCOPE if the registration used something narrower.
      scope: process.env.TEBRA_FHIR_SCOPE?.trim() || 'system/*.read',
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `FHIR token request failed (${response.status}): ${truncateBody(text)}. ` +
      'Note: both the practice and the backend-service client must be activated by Tebra Customer Care before tokens are issued.'
    );
  }

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
  return !!(process.env.TEBRA_FHIR_CLIENT_ID && process.env.TEBRA_FHIR_CLIENT_SECRET);
}

export function getFhirConfig(): FhirConfig {
  const clientId = process.env.TEBRA_FHIR_CLIENT_ID;
  const clientSecret = process.env.TEBRA_FHIR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('FHIR credentials not configured. Set TEBRA_FHIR_CLIENT_ID and TEBRA_FHIR_CLIENT_SECRET.');
  }

  return {
    clientId,
    clientSecret,
    // Live-verified 2026-08-03: the path segment is fhir-request (hyphen).
    baseUrl: process.env.TEBRA_FHIR_BASE_URL?.trim() ?? 'https://fhir.prd.cloud.tebra.com/fhir-request',
    tokenUrl: process.env.TEBRA_FHIR_TOKEN_URL?.trim() ?? 'https://fhir.prd.cloud.tebra.com/smartauth/oauth/token',
  };
}
