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
import { handlePracticeTool } from '../tools/practices.js';
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

  it('emits RequestHeader children in WSDL order: CustomerKey, Password, User', async () => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      fetchCalls.push({ url, init });
      return new Response(
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<s:Body><GetPracticesResponse/></s:Body>' +
          '</s:Envelope>',
        { status: 200 }
      );
    }) as typeof fetch;

    await soapRequest(
      config,
      'GetPractices',
      '<kar:request><kar:Fields /></kar:request>'
    );

    const body = fetchCalls[0].init.body as string;
    const customerKeyIdx = body.indexOf('<kar:CustomerKey>');
    const passwordIdx = body.indexOf('<kar:Password>');
    const userIdx = body.indexOf('<kar:User>');

    assert.ok(customerKeyIdx > -1, 'CustomerKey element must be present');
    assert.ok(passwordIdx > -1, 'Password element must be present');
    assert.ok(userIdx > -1, 'User element must be present');

    // Tebra's WSDL declares the sequence as CustomerKey → Password → User.
    // Sending User before Password causes authorization failures even with
    // valid credentials.
    assert.ok(
      customerKeyIdx < passwordIdx && passwordIdx < userIdx,
      `RequestHeader order must be CustomerKey, Password, User — got positions ${customerKeyIdx}, ${passwordIdx}, ${userIdx}`
    );
  });

  it('GetPractices body includes empty <kar:Filter /> to avoid server-side NullRef', async () => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      fetchCalls.push({ url, init });
      return new Response(
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<s:Body><GetPracticesResponse xmlns="http://www.kareo.com/api/schemas/">' +
          '<GetPracticesResult><ErrorResponse><IsError>false</IsError></ErrorResponse>' +
          '<Practices/></GetPracticesResult></GetPracticesResponse></s:Body>' +
          '</s:Envelope>',
        { status: 200 }
      );
    }) as typeof fetch;

    await handlePracticeTool('tebra_get_practices', {}, config);

    assert.equal(fetchCalls.length, 1);
    const body = fetchCalls[0].init.body as string;

    // Even though the WSDL marks Filter minOccurs=0, Tebra's server-side
    // GetFilteredPractices NullRefs without it. Confirmed live 2026-04-28.
    assert.match(
      body,
      /<kar:Filter\s*\/>/,
      'GetPractices body must include an empty <kar:Filter /> element'
    );

    // Order matters too: Fields must come before Filter per WSDL sequence.
    const fieldsEndIdx = body.indexOf('</kar:Fields>');
    const fieldsSelfCloseIdx = body.search(/<kar:Fields\s*\/>/);
    const fieldsAnyIdx = fieldsEndIdx > -1 ? fieldsEndIdx : fieldsSelfCloseIdx;
    const filterIdx = body.search(/<kar:Filter\s*\/>/);
    assert.ok(
      fieldsAnyIdx > -1 && filterIdx > fieldsAnyIdx,
      'Fields must precede Filter in the request body per WSDL sequence'
    );
  });
});
