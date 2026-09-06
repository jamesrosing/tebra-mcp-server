/**
 * Retry safety for non-idempotent SOAP actions (issue #13).
 *
 * A request timeout is ambiguous: Tebra may have already committed the write
 * and only the response was lost. Re-sending CreatePayment in that state posts
 * a second payment to the patient's account, silently. Create* actions may
 * therefore only be retried on failures that provably happened before Tebra
 * could act (throttling, connection refused); everything else surfaces as an
 * AmbiguousOutcomeError telling the caller to verify before resubmitting.
 * Read actions keep the full retry behaviour.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { soapRequest, AmbiguousOutcomeError } from '../soap-client.js';
import type { TebraConfig } from '../config.js';

const config: TebraConfig = {
  user: 'svc@example.com',
  password: 'pw',
  customerKey: 'ck-123',
  endpoint: 'https://example.test/soap',
};

const ok = (action: string) =>
  new Response(
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
      `<s:Body><${action}Response><${action}Result><PaymentID>42</PaymentID></${action}Result></${action}Response></s:Body>` +
      '</s:Envelope>',
    { status: 200 }
  );

const timeoutError = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');
const connectionRefused = () =>
  new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });

describe('SOAP retry safety for non-idempotent actions', () => {
  let originalFetch: typeof fetch;
  let calls: number;

  const fetchSequence = (steps: Array<() => Response | Error>) => {
    globalThis.fetch = (async () => {
      const step = steps[Math.min(calls, steps.length - 1)];
      calls++;
      const result = step();
      if (result instanceof Error) throw result;
      return result;
    }) as typeof fetch;
  };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    calls = 0;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('CreatePayment is NOT re-sent after a timeout; the error says the outcome is unknown and how to verify', async () => {
    fetchSequence([() => timeoutError(), () => ok('CreatePayment')]);

    await assert.rejects(
      soapRequest(config, 'CreatePayment', '<kar:request></kar:request>'),
      (error: unknown) => {
        assert.ok(error instanceof AmbiguousOutcomeError, `expected AmbiguousOutcomeError, got ${String(error)}`);
        assert.match(error.message, /CreatePayment/);
        assert.match(error.message, /may have reached Tebra/i);
        assert.match(error.message, /tebra_get_payments/);
        return true;
      }
    );
    assert.equal(calls, 1, 'a non-idempotent action must be sent exactly once on timeout');
  });

  it('CreatePayment is NOT re-sent after an HTTP 5xx (the server may have committed before failing)', async () => {
    fetchSequence([() => new Response('<html>Bad Gateway</html>', { status: 502 }), () => ok('CreatePayment')]);

    await assert.rejects(soapRequest(config, 'CreatePayment', '<kar:request></kar:request>'), AmbiguousOutcomeError);
    assert.equal(calls, 1);
  });

  it('CreatePayment IS retried after a 429 throttle (Tebra rejected it before acting)', async () => {
    fetchSequence([() => new Response('throttled', { status: 429 }), () => ok('CreatePayment')]);

    const xml = await soapRequest(config, 'CreatePayment', '<kar:request></kar:request>');
    assert.match(xml, /<PaymentID>42<\/PaymentID>/);
    assert.equal(calls, 2);
  });

  it('CreatePayment IS retried after a connection refusal (nothing reached Tebra)', async () => {
    fetchSequence([() => connectionRefused(), () => ok('CreatePayment')]);

    const xml = await soapRequest(config, 'CreatePayment', '<kar:request></kar:request>');
    assert.match(xml, /<PaymentID>42<\/PaymentID>/);
    assert.equal(calls, 2);
  });

  it('every other Create* action gets the same guard', async () => {
    for (const action of ['CreatePatient', 'CreateAppointment', 'CreateEncounter', 'CreateDocument', 'CreateAppointmentReason']) {
      calls = 0;
      fetchSequence([() => timeoutError(), () => ok(action)]);
      await assert.rejects(soapRequest(config, action, '<kar:request></kar:request>'), AmbiguousOutcomeError, action);
      assert.equal(calls, 1, `${action} must not be re-sent after a timeout`);
    }
  });

  it('read actions still retry a timeout', async () => {
    fetchSequence([() => timeoutError(), () => ok('GetPatients')]);

    const xml = await soapRequest(config, 'GetPatients', '<kar:request></kar:request>');
    assert.match(xml, /GetPatientsResponse/);
    assert.equal(calls, 2);
  });
});
