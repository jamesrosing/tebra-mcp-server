/**
 * Regression tests for the SOAP client.
 *
 * Run via `npm test` (uses node:test through tsx). The hot path here is the
 * SOAPAction header — it must include the `KareoServices/` contract segment
 * or Kareo's WCF dispatcher rejects every request with HTTP 500
 * (`ContractFilter mismatch at the EndpointDispatcher`).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { soapRequest } from '../soap-client.js';
import type { TebraConfig } from '../config.js';

const config: TebraConfig = {
  user: 'svc@example.com',
  password: 'pw',
  customerKey: 'ck-123',
  endpoint: 'https://example.test/soap',
};

describe('Tebra SOAP client', () => {
  let originalFetch: typeof fetch;
  let fetchCalls: Array<{ url: string; init: RequestInit }>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends SOAPAction including the KareoServices contract segment', async () => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      fetchCalls.push({ url, init });
      return new Response(
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<s:Body><GetPracticesResponse/></s:Body>' +
          '</s:Envelope>',
        { status: 200 }
      );
    }) as typeof fetch;

    await soapRequest(config, 'GetPractices', '<kar:request></kar:request>');

    assert.equal(fetchCalls.length, 1);

    const headers = fetchCalls[0].init.headers as Record<string, string>;
    assert.equal(
      headers.SOAPAction,
      '"http://www.kareo.com/api/schemas/KareoServices/GetPractices"',
      'SOAPAction must include the KareoServices/ contract segment and be quoted'
    );
    assert.equal(headers['Content-Type'], 'text/xml; charset=utf-8');

    const body = fetchCalls[0].init.body as string;
    assert.match(
      body,
      /xmlns:kar="http:\/\/www\.kareo\.com\/api\/schemas\/"/,
      'XML namespace should remain unprefixed (only the SOAPAction header carries the contract)'
    );
    assert.match(body, /<kar:GetPractices>/);
  });
});
