/**
 * FHIR error text must be scrubbed before it is surfaced.
 *
 * The SOAP path scrubs request PHI out of server errors (phiValues/scrub);
 * the FHIR path is JSON so the XML phiValues scan does not apply, but search
 * params still carry patient identifiers (name, birthdate, …) that a server
 * can echo back in an OperationOutcome. Scrub the URL's query-param values
 * out of the error body before truncating it — scrub-then-slice, the same
 * ordering the SOAP client uses.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { fhirRequest, type FhirConfig } from '../fhir-client.js';

const config: FhirConfig = {
  clientId: 'redaction-test-client',
  clientSecret: 'shh',
  baseUrl: 'https://fhir.example.test/fhir-request',
  tokenUrl: 'https://fhir.example.test/smartauth/oauth/token',
};

describe('FHIR error redaction', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('scrubs query-param values the server echoes in an OperationOutcome', async () => {
    // Call 1 is the client_credentials token request; call 2 is the FHIR GET.
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === config.tokenUrl) {
        return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'error', diagnostics: 'Unknown name match: Jane Q Doe' }],
        }),
        { status: 400 }
      );
    }) as typeof fetch;

    await assert.rejects(
      fhirRequest(config, 'Patient', { name: 'Jane Q Doe' }),
      (err: Error) => {
        assert.ok(!err.message.includes('Jane Q Doe'), `full name leaked: ${err.message}`);
        assert.ok(!err.message.includes('Jane'), `first name leaked: ${err.message}`);
        assert.ok(!err.message.includes('Doe'), `last name leaked: ${err.message}`);
        assert.ok(err.message.includes('***'), `expected scrubbed markers: ${err.message}`);
        // The resource path (no query string) must still identify the failure.
        assert.match(err.message, /\/Patient/);
        return true;
      }
    );
  });
});
