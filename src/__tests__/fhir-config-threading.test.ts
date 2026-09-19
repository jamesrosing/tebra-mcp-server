/**
 * FHIR config is threaded through handlers (like TebraConfig is for SOAP)
 * and the OAuth token cache is keyed per client, so two configurations in
 * one process never share a bearer token. Offline: fetch is stubbed.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { fhirRequest, type FhirConfig } from '../fhir-client.js';
import { handleFhirAllergyTool } from '../tools/fhir/allergies.js';

const BASE = 'https://fhir.example.test/fhir-request';
const TOKEN_URL = 'https://fhir.example.test/oauth/token';

const configFor = (clientId: string): FhirConfig => ({
  clientId, clientSecret: 's', baseUrl: BASE, tokenUrl: TOKEN_URL,
});

const emptyBundle = () =>
  new Response(JSON.stringify({ resourceType: 'Bundle', entry: [] }), { status: 200 });

describe('FHIR config threading', () => {
  let originalFetch: typeof fetch;
  let resourceCalls: Array<{ url: string; auth: string | null }>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    resourceCalls = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === TOKEN_URL) {
        const clientId = new URLSearchParams(String(init?.body)).get('client_id');
        return new Response(JSON.stringify({ access_token: `tok-${clientId}`, expires_in: 3600 }), { status: 200 });
      }
      const headers = new Headers(init?.headers);
      resourceCalls.push({ url, auth: headers.get('Authorization') });
      return emptyBundle();
    }) as typeof fetch;
  });

  afterEach(() => { globalThis.fetch = originalFetch; });

  it('caches bearer tokens per client, not per process', async () => {
    await fhirRequest(configFor('client-a'), 'Patient');
    await fhirRequest(configFor('client-b'), 'Patient');
    await fhirRequest(configFor('client-a'), 'Patient');

    assert.deepEqual(resourceCalls.map((c) => c.auth), ['Bearer tok-client-a', 'Bearer tok-client-b', 'Bearer tok-client-a']);
  });

  it('handlers use the config they are given rather than the environment', async () => {
    const saved = { ...process.env };
    for (const k of Object.keys(process.env)) if (k.startsWith('TEBRA_FHIR_')) delete process.env[k];
    try {
      const result = await handleFhirAllergyTool('tebra_fhir_get_allergies', { patientId: 'p1' }, configFor('client-c'));
      assert.equal(resourceCalls.length, 1);
      assert.equal(resourceCalls[0].url, `${BASE}/AllergyIntolerance?patient=p1`);
      assert.equal(resourceCalls[0].auth, 'Bearer tok-client-c');
      assert.ok(result.content[0].text);
    } finally {
      for (const k of Object.keys(process.env)) if (k.startsWith('TEBRA_FHIR_')) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});
