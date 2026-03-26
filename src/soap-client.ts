/**
 * SOAP client for the Tebra MCP server.
 *
 * Standalone version (no Next.js dependencies).
 * Builds SOAP XML envelopes, sends via fetch, parses responses.
 * Retry with exponential backoff: 3 attempts at 1s, 2s, 4s.
 */

import type { TebraConfig } from './config.js';

// ─── Constants ──────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const SOAP_NAMESPACE = 'http://www.kareo.com/api/schemas/';

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

function buildEnvelope(config: TebraConfig, action: string, bodyXml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:kar="${SOAP_NAMESPACE}">
  <soap:Header>
    <kar:RequestHeader>
      <kar:User>${escapeXml(config.user)}</kar:User>
      <kar:Password>${escapeXml(config.password)}</kar:Password>
      <kar:CustomerKey>${escapeXml(config.customerKey)}</kar:CustomerKey>
    </kar:RequestHeader>
  </soap:Header>
  <soap:Body>
    <kar:${action}>
      ${bodyXml}
    </kar:${action}>
  </soap:Body>
</soap:Envelope>`;
}

// ─── SOAP Request with Retry ────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function soapRequest(
  config: TebraConfig,
  action: string,
  bodyXml: string
): Promise<string> {
  const soapAction = `${SOAP_NAMESPACE}${action}`;
  const envelope = buildEnvelope(config, action, bodyXml);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: soapAction,
        },
        body: envelope,
      });

      const responseText = await response.text();

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
