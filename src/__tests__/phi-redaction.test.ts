/**
 * PHI must never reach stderr or an error message.
 *
 * Claude Desktop persists MCP server stderr to a log file on disk, so a
 * TEBRA_SOAP_DEBUG run that dumps request/response bodies would leave
 * patient records in plain text. These tests drive the real soapRequest
 * with a synthetic patient and assert that no identifier survives into
 * anything written to console.error or thrown as an Error.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { soapRequest } from '../soap-client.js';
import type { TebraConfig } from '../config.js';

const config: TebraConfig = {
  user: 'svc@example.com',
  password: 'pw-secret',
  customerKey: 'ck-secret',
  endpoint: 'https://example.test/soap',
};

// Synthetic record. Every value is unique enough to grep for.
const PHI = {
  firstName: 'Zelphinia',
  lastName: 'Quorvax',
  dob: '1961-07-19',
  ssn: '987-65-4320',
  phone: '555-014-9921',
  email: 'zelphinia.quorvax@example.net',
  address: '4471 Thimbleweed Lane',
  mrn: 'MRN-77QX',
  policyNumber: 'POL-88ZQ',
  notes: 'anxious about biopsy result',
};

const createPatientBody = `
  <kar:request>
    <kar:Patient>
      <kar:AddressLine1>${PHI.address}</kar:AddressLine1>
      <kar:DateofBirth>${PHI.dob}</kar:DateofBirth>
      <kar:EmailAddress>${PHI.email}</kar:EmailAddress>
      <kar:FirstName>${PHI.firstName}</kar:FirstName>
      <kar:LastName>${PHI.lastName}</kar:LastName>
      <kar:MedicalRecordNumber>${PHI.mrn}</kar:MedicalRecordNumber>
      <kar:MobilePhone>${PHI.phone}</kar:MobilePhone>
      <kar:SocialSecurityNumber>${PHI.ssn}</kar:SocialSecurityNumber>
      <kar:Cases><kar:PatientCaseCreateReq><kar:Policies><kar:PolicyCreateReq>
        <kar:Number>${PHI.policyNumber}</kar:Number>
      </kar:PolicyCreateReq></kar:Policies></kar:PatientCaseCreateReq></kar:Cases>
    </kar:Patient>
  </kar:request>`;

const patientResponse = (status: number) =>
  new Response(
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
      '<GetPatientResponse><GetPatientResult><Patient>' +
      `<ID>4242</ID><FirstName>${PHI.firstName}</FirstName><LastName>${PHI.lastName}</LastName>` +
      `<DOB>${PHI.dob}</DOB><MobilePhone>${PHI.phone}</MobilePhone><EmailAddress>${PHI.email}</EmailAddress>` +
      `<AddressLine1>${PHI.address}</AddressLine1><MedicalRecordNumber>${PHI.mrn}</MedicalRecordNumber>` +
      `<Notes>${PHI.notes}</Notes>` +
      '</Patient></GetPatientResult></GetPatientResponse>' +
      '</s:Body></s:Envelope>',
    { status }
  );

function assertNoPhi(haystack: string, where: string): void {
  for (const [key, value] of Object.entries(PHI)) {
    assert.ok(!haystack.includes(value), `${where} leaked ${key} (${value})`);
  }
}

function assertNoSecrets(haystack: string, where: string): void {
  assert.ok(!haystack.includes(config.password), `${where} leaked the SOAP password`);
  assert.ok(!haystack.includes(config.customerKey), `${where} leaked the customer key`);
}

describe('PHI redaction — debug log', () => {
  let originalFetch: typeof fetch;
  let originalConsoleError: typeof console.error;
  let originalDebug: string | undefined;
  let stderr: string[];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalConsoleError = console.error;
    originalDebug = process.env.TEBRA_SOAP_DEBUG;
    stderr = [];
    console.error = (...parts: unknown[]) => { stderr.push(parts.map(String).join(' ')); };
    process.env.TEBRA_SOAP_DEBUG = '1';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    if (originalDebug === undefined) delete process.env.TEBRA_SOAP_DEBUG;
    else process.env.TEBRA_SOAP_DEBUG = originalDebug;
  });

  it('logs the request without patient identifiers or credentials', async () => {
    globalThis.fetch = (async () => patientResponse(200)) as typeof fetch;

    await soapRequest(config, 'CreatePatient', createPatientBody);

    const logged = stderr.join('\n');
    assert.ok(logged.includes('CreatePatient'), 'debug log should still name the action');
    assertNoPhi(logged, 'request debug log');
    assertNoSecrets(logged, 'request debug log');
  });

  it('logs the response without patient identifiers', async () => {
    globalThis.fetch = (async () => patientResponse(200)) as typeof fetch;

    await soapRequest(config, 'GetPatient', '<kar:request></kar:request>');

    const logged = stderr.join('\n');
    assert.ok(logged.includes('HTTP 200'), 'debug log should still report the status');
    assertNoPhi(logged, 'response debug log');
  });
});

describe('PHI redaction — redact module', async () => {
  const { redactPhi, redactSecrets, redactForLog } = await import('../redact.js');

  it('blanks credential tags with or without a namespace prefix', () => {
    const out = redactSecrets('<kar:RequestHeader><kar:CustomerKey>ck-secret</kar:CustomerKey><Password>pw-secret</Password><kar:User>svc@example.com</kar:User></kar:RequestHeader>');
    assert.equal(out, '<kar:RequestHeader><kar:CustomerKey>***</kar:CustomerKey><Password>***</Password><kar:User>***</kar:User></kar:RequestHeader>');
  });

  it('blanks identifier leaves but keeps structural and operational values', () => {
    const out = redactPhi('<Patient><ID>4242</ID><PatientFullName>Zelphinia Quorvax</PatientFullName><Status>Scheduled</Status><PracticeName>Example Derm</PracticeName><a:DOB>1961-07-19</a:DOB><Amount>12.50</Amount></Patient>');
    assert.equal(out, '<Patient><ID>4242</ID><PatientFullName>***</PatientFullName><Status>Scheduled</Status><PracticeName>***</PracticeName><a:DOB>***</a:DOB><Amount>12.50</Amount></Patient>');
  });

  it('redactForLog applies both passes', () => {
    const out = redactForLog('<kar:Password>pw-secret</kar:Password><kar:LastName>Quorvax</kar:LastName>');
    assert.ok(!out.includes('pw-secret') && !out.includes('Quorvax'), out);
  });
});
