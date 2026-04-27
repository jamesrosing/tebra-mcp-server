/**
 * SOAP client for the Tebra MCP server.
 *
 * Standalone version (no Next.js dependencies).
 * Builds SOAP XML envelopes, sends via fetch, parses responses.
 * Per-endpoint rate limiting from Tebra API Technical Guide.
 * Retry with exponential backoff: 3 attempts at 1s, 2s, 4s.
 */

import type { TebraConfig } from './config.js';

// ─── Constants ──────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const SOAP_NAMESPACE = 'http://www.kareo.com/api/schemas/';

// ─── Per-Endpoint Rate Limits (ms) from Tebra API Technical Guide ──

const ENDPOINT_RATE_LIMITS: Record<string, number> = {
  GetAllPatients: 5000,
  GetAppointment: 500,
  GetAppointments: 1000,
  GetAppointmentReasons: 1000,
  GetCharges: 1000,
  GetEncounterDetails: 500,
  GetExternalVendors: 1000,
  GetPatient: 250,
  GetPatients: 1000,
  GetPayments: 1000,
  GetPractices: 500,
  GetProcedureCodes: 500,
  GetProviders: 500,
  GetServiceLocations: 500,
  GetThrottles: 5000,
  GetTransactions: 1000,
  CreateAppointment: 500,
  CreateEncounter: 500,
  CreatePatient: 500,
  CreatePayments: 500,
  UpdateAppointment: 500,
  UpdateEncounterStatus: 500,
  UpdatePatient: 1000,
  DeleteAppointment: 500,
};

// Track last call time per endpoint
const lastCallTimestamps: Record<string, number> = {};

// ─── XML Helpers ────────────────────────────────────────────────

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function extractTag(xml: string, tagName: string): string {
  const pattern = new RegExp(
    `<(?:[a-zA-Z0-9]+:)?${tagName}[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tagName}>`,
    'i'
  );
  const match = xml.match(pattern);
  return match?.[1]?.trim() ?? '';
}

export function extractAllTags(xml: string, tagName: string): string[] {
  const pattern = new RegExp(
    `<(?:[a-zA-Z0-9]+:)?${tagName}[^>]*>[\\s\\S]*?</(?:[a-zA-Z0-9]+:)?${tagName}>`,
    'gi'
  );
  return xml.match(pattern) ?? [];
}

export function extractNumber(xml: string, tagName: string): number {
  const val = extractTag(xml, tagName);
  const num = parseInt(val, 10);
  return isNaN(num) ? 0 : num;
}

// ─── Envelope Builder ───────────────────────────────────────────

/**
 * Inject the RequestHeader (User/Password/CustomerKey) as the first child of
 * the operation's <kar:request> element. Tebra's WSDL declares RequestHeader
 * as a body parameter — placing it in <soap:Header> causes WCF to reject the
 * request before authentication is even checked.
 */
function injectRequestHeader(config: TebraConfig, bodyXml: string): string {
  const header =
    `<kar:RequestHeader>` +
      `<kar:CustomerKey>${escapeXml(config.customerKey)}</kar:CustomerKey>` +
      `<kar:User>${escapeXml(config.user)}</kar:User>` +
      `<kar:Password>${escapeXml(config.password)}</kar:Password>` +
    `</kar:RequestHeader>`;

  // Body is always wrapped in <kar:request>...</kar:request>. Insert the
  // header immediately after the opening tag so it's the first child.
  const openTagPattern = /<kar:request(\s[^>]*)?>/;
  if (!openTagPattern.test(bodyXml)) {
    throw new Error(
      'soapRequest body must be wrapped in <kar:request>...</kar:request>'
    );
  }
  return bodyXml.replace(openTagPattern, (match) => `${match}${header}`);
}

function buildEnvelope(config: TebraConfig, action: string, bodyXml: string): string {
  const bodyWithHeader = injectRequestHeader(config, bodyXml);
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:kar="${SOAP_NAMESPACE}">
  <soap:Body>
    <kar:${action}>
      ${bodyWithHeader}
    </kar:${action}>
  </soap:Body>
</soap:Envelope>`;
}

function redactSecrets(xml: string): string {
  return xml
    .replace(/<kar:User>[^<]*<\/kar:User>/g, '<kar:User>***</kar:User>')
    .replace(/<kar:Password>[^<]*<\/kar:Password>/g, '<kar:Password>***</kar:Password>')
    .replace(/<kar:CustomerKey>[^<]*<\/kar:CustomerKey>/g, '<kar:CustomerKey>***</kar:CustomerKey>');
}

// ─── SecurityResponse Check ─────────────────────────────────────

function checkSecurityResponse(responseXml: string, action: string): void {
  const securityBlock = extractTag(responseXml, 'SecurityResponse');
  if (!securityBlock) return; // Some responses may not include it

  const authenticated = extractTag(securityBlock, 'Authenticated');
  if (authenticated && authenticated.toLowerCase() === 'false') {
    throw new Error(
      `Tebra authentication failed for ${action}. Check TEBRA_SOAP_USER and TEBRA_SOAP_PASSWORD.`
    );
  }

  const authorized = extractTag(securityBlock, 'Authorized');
  if (authorized && authorized.toLowerCase() === 'false') {
    const missing = extractTag(securityBlock, 'PermissionsMissing');
    throw new Error(
      `Tebra authorization failed for ${action}. Missing permissions: ${missing || 'unknown'}. ` +
      'Contact your Tebra administrator to grant API permissions.'
    );
  }
}

// ─── SOAP Request with Rate Limiting & Retry ────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enforce per-endpoint rate limiting before making a request.
 * Waits if the minimum interval since the last call hasn't elapsed.
 */
async function enforceRateLimit(action: string): Promise<void> {
  const minInterval = ENDPOINT_RATE_LIMITS[action];
  if (!minInterval) return; // Unknown endpoint — no rate limit enforced

  const lastCall = lastCallTimestamps[action];
  if (lastCall) {
    const elapsed = Date.now() - lastCall;
    if (elapsed < minInterval) {
      await sleep(minInterval - elapsed);
    }
  }

  lastCallTimestamps[action] = Date.now();
}

export async function soapRequest(
  config: TebraConfig,
  action: string,
  bodyXml: string
): Promise<string> {
  const soapAction = `${SOAP_NAMESPACE}${action}`;
  // SOAP 1.1 requires SOAPAction to be a quoted string. WCF dispatchers can
  // reject unquoted values with a ContractFilter mismatch.
  const soapActionHeader = `"${soapAction}"`;
  const envelope = buildEnvelope(config, action, bodyXml);
  const debug = process.env.TEBRA_SOAP_DEBUG === '1' || process.env.TEBRA_SOAP_DEBUG === 'true';
  let lastError: Error | null = null;

  if (debug) {
    console.error(`[tebra-soap] POST ${config.endpoint}`);
    console.error(`[tebra-soap] SOAPAction: ${soapActionHeader}`);
    console.error(`[tebra-soap] Request body:\n${redactSecrets(envelope)}`);
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Pre-emptive rate limiting
      await enforceRateLimit(action);

      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: soapActionHeader,
        },
        body: envelope,
      });

      const responseText = await response.text();

      if (debug) {
        console.error(`[tebra-soap] HTTP ${response.status} for ${action}`);
        console.error(`[tebra-soap] Response body:\n${responseText.slice(0, 2000)}`);
      }

      if (!response.ok) {
        const faultString = extractTag(responseText, 'faultstring');
        throw new Error(
          `SOAP ${action} failed (HTTP ${response.status}): ${faultString || response.statusText}`
        );
      }

      const faultString = extractTag(responseText, 'faultstring');
      if (faultString) {
        throw new Error(`SOAP fault from ${action}: ${faultString}`);
      }

      const errorResponse = extractTag(responseText, 'ErrorResponse');
      if (errorResponse) {
        const isError = extractTag(errorResponse, 'IsError');
        if (isError.toLowerCase() === 'true') {
          const errorMsg = extractTag(errorResponse, 'ErrorMessage');
          throw new Error(`Tebra ${action} error: ${errorMsg || 'Unknown error'}`);
        }
      }

      // Check SecurityResponse for auth/permission failures
      checkSecurityResponse(responseText, action);

      return responseText;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < MAX_RETRIES) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delayMs);
      }
    }
  }

  throw new Error(
    `SOAP ${action} failed after ${MAX_RETRIES} attempts: ${lastError?.message ?? 'Unknown error'}`
  );
}
