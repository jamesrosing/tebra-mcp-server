/**
 * Bundle paging link handling (fhirRequestUrl) — offline only.
 *
 * Paging URLs come from the SERVER's response, so a hostile or broken
 * response must not be able to walk the bearer token (and PHI-bearing query
 * params) off the configured FHIR host. These tests pin the same-origin
 * gate: it must fire BEFORE any token request or fetch, while well-formed
 * same-origin links keep working exactly as before.
 *
 * Fetch is a mocked global (save/restore per test, mirroring
 * fhir-client-auth.test.ts); nothing here talks to Tebra.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { fhirRequestUrl, type FhirConfig } from '../fhir-client.js';

const TOKEN_URL = 'https://fhir.example.test/smartauth/oauth/token';
const BASE_URL = 'https://fhir.example.test/fhir-request';

// client_secret-style config so the token flow is the simple
// client_credentials POST (no key material needed).
function makeConfig(clientId: string): FhirConfig {
  return { clientId, clientSecret: 'shh', baseUrl: BASE_URL, tokenUrl: TOKEN_URL };
}

describe('fhirRequestUrl: Bundle paging link origin check', () => {
  let originalFetch: typeof fetch;
  // Every fetch made while a test runs, so we can assert "none happened"
  // (the origin check must fire before any network/token activity).
  let calls: Array<{ url: unknown; init?: RequestInit }>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    calls = [];
    // Default stub records the call and returns an empty Bundle. Tests that
    // expect real traffic replace it with a scripted responder.
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ resourceType: 'Bundle', entry: [] }), { status: 200 });
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('REJECTS a cross-origin paging link before any fetch or token request', async () => {
    // Distinct client id: the module-level tokenCache is keyed per client,
    // so this test can never be served a token cached by another file.
    const config = makeConfig('pagination-cross-origin');
    await assert.rejects(
      fhirRequestUrl(config, 'https://evil.example.test/steal?x=1'),
      /evil\.example\.test|origin/i,
    );
    // The check must short-circuit BEFORE getAccessToken/fetch — zero calls.
    assert.equal(calls.length, 0, 'cross-origin link must not trigger any fetch (not even the token request)');
  });

  it('REJECTS a scheme downgrade to the same host (http origin ≠ https origin)', async () => {
    const config = makeConfig('pagination-scheme-downgrade');
    await assert.rejects(
      fhirRequestUrl(config, 'http://fhir.example.test/fhir-request/Patient?_getpages=x'),
      /origin/i,
    );
    assert.equal(calls.length, 0, 'downgraded link must not trigger any fetch');
  });

  it('REJECTS a malformed paging link', async () => {
    const config = makeConfig('pagination-malformed');
    await assert.rejects(fhirRequestUrl(config, 'not a url'), /Malformed|refusing/i);
    assert.equal(calls.length, 0, 'malformed link must not trigger any fetch');
  });

  it('STILL FOLLOWS a same-origin paging link (token POST, then the paging URL with the bearer)', async () => {
    const config = makeConfig('pagination-same-origin');
    const bundle = { resourceType: 'Bundle', entry: [] };
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url, init });
      if (String(url) === TOKEN_URL) {
        // Mirror getAccessToken's expected client-credentials response shape.
        return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify(bundle), { status: 200 });
    }) as typeof fetch;

    const pagingUrl = 'https://fhir.example.test/fhir-request/Patient?_getpages=abc';
    const result = await fhirRequestUrl(config, pagingUrl);

    assert.deepEqual(result, bundle);
    assert.equal(calls.length, 2, 'one token POST plus the paging-link GET');
    assert.equal(String(calls[1].url), pagingUrl);
    const headers = calls[1].init?.headers as Record<string, string> | undefined;
    assert.equal(headers?.Authorization, 'Bearer test-token');
  });
});
