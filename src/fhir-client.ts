/**
 * FHIR R4 client for the Tebra MCP server.
 *
 * Handles OAuth2 client_credentials flow for Tebra's FHIR API.
 * Token caching with automatic refresh. Clean module with no side effects on import.
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
      scope: 'system/*.read',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `FHIR token request failed (${response.status}): ${text}`
    );
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

export async function fhirRequest(
  config: FhirConfig,
  resource: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const token = await getAccessToken(config);
  const url = new URL(`${config.baseUrl}/${resource}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/fhir+json',
    },
  });

  if (response.status === 401) {
    cachedToken = null;
    throw new Error('FHIR authentication expired — token cleared, retry will re-authenticate');
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`FHIR ${resource} request failed (${response.status}): ${text}`);
  }

  return response.json();
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
    baseUrl: process.env.TEBRA_FHIR_BASE_URL?.trim() ?? 'https://fhir.prd.cloud.tebra.com/fhir/request',
    tokenUrl: process.env.TEBRA_FHIR_TOKEN_URL?.trim() ?? 'https://fhir.prd.cloud.tebra.com/smartauth/oauth/token',
  };
}
