/**
 * Configuration loader for the Tebra MCP server.
 * Validates required environment variables at startup.
 *
 * Required environment variables (SOAP API):
 *   TEBRA_SOAP_USER      — SOAP API user (email)
 *   TEBRA_SOAP_PASSWORD   — SOAP API password
 *   TEBRA_CUSTOMER_KEY    — Customer key from Tebra PM admin
 *   TEBRA_SOAP_ENDPOINT   — (optional) Override SOAP endpoint URL
 *
 * Optional environment variables (FHIR R4 API — enables clinical data tools):
 *   TEBRA_FHIR_CLIENT_ID     — OAuth2 client ID from Tebra FHIR registration
 *   TEBRA_FHIR_CLIENT_SECRET — OAuth2 client secret
 *   TEBRA_FHIR_BASE_URL      — (optional) FHIR API base URL (default: Tebra production)
 *   TEBRA_FHIR_TOKEN_URL     — (optional) OAuth2 token endpoint (default: Tebra production)
 */

export interface TebraConfig {
  user: string;
  password: string;
  customerKey: string;
  endpoint: string;
}

const TEBRA_SOAP_ENDPOINT =
  'https://webservice.kareo.com/services/soap/2.1/KareoServices.svc';

/**
 * Load and validate Tebra configuration from environment variables.
 * Fails fast with a clear error if required vars are missing.
 */
export function getConfig(): TebraConfig {
  const user = process.env.TEBRA_SOAP_USER;
  const password = process.env.TEBRA_SOAP_PASSWORD;
  const customerKey = process.env.TEBRA_CUSTOMER_KEY;

  const missing: string[] = [];
  if (!user) missing.push('TEBRA_SOAP_USER');
  if (!password) missing.push('TEBRA_SOAP_PASSWORD');
  if (!customerKey) missing.push('TEBRA_CUSTOMER_KEY');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}.\n` +
      'Set these in your environment or .env file before starting the MCP server.'
    );
  }

  return {
    user: user!.trim(),
    password: password!.trim(),
    customerKey: customerKey!.trim(),
    endpoint: process.env.TEBRA_SOAP_ENDPOINT?.trim() ?? TEBRA_SOAP_ENDPOINT,
  };
}
