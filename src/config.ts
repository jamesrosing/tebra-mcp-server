/**
 * Configuration loader for the Tebra MCP server.
 * Validates required environment variables at startup.
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
