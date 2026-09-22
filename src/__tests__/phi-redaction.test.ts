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

  // create_document ships a base64 document body inside <kar:FileContent>; its
  // local name carries no identifier fragment, so it must be added to the PHI
  // pattern explicitly or the raw document bytes reach stderr under
  // TEBRA_SOAP_DEBUG (and slip past phiValues/scrub for error messages).
  it('redactForLog blanks FileContent so a base64 document body is not logged raw', () => {
    const payload = 'QUJDREVGR0hJSktMTU5PUA==';
    const out = redactForLog(`<kar:FileContent>${payload}</kar:FileContent>`);
    assert.ok(out.includes('***'), `expected FileContent to be blanked, got: ${out}`);
    assert.ok(!out.includes(payload), `base64 document body leaked: ${out}`);
  });
});

describe('PHI redaction — error messages', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  const soapFault = (status: number, text: string) =>
    new Response(
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>' +
        `<faultcode>s:Client</faultcode><faultstring>${text}</faultstring>` +
        '</s:Fault></s:Body></s:Envelope>',
      { status }
    );

  const echoingFault = `Patient ${PHI.firstName} ${PHI.lastName} born ${PHI.dob} (${PHI.email}) already exists`;

  it('SOAP HTTP fault text is scrubbed of values sent in the request body', async () => {
    globalThis.fetch = (async () => soapFault(400, echoingFault)) as typeof fetch;

    await assert.rejects(
      soapRequest(config, 'CreatePatient', createPatientBody),
      (err: Error) => {
        assert.match(err.message, /CreatePatient/);
        assertNoPhi(err.message, 'HTTP fault message');
        return true;
      }
    );
  });

  it('SOAP 200 fault text is scrubbed of values sent in the request body', async () => {
    globalThis.fetch = (async () => soapFault(200, echoingFault)) as typeof fetch;

    await assert.rejects(
      soapRequest(config, 'CreatePatient', createPatientBody),
      (err: Error) => { assertNoPhi(err.message, '200 fault message'); return true; }
    );
  });

  it('Tebra ErrorResponse text is scrubbed of values sent in the request body', async () => {
    globalThis.fetch = (async () =>
      new Response(
        '<s:Envelope><s:Body><CreatePatientResponse><CreatePatientResult>' +
          `<ErrorResponse><IsError>true</IsError><ErrorMessage>${echoingFault}</ErrorMessage></ErrorResponse>` +
          '</CreatePatientResult></CreatePatientResponse></s:Body></s:Envelope>',
        { status: 200 }
      )) as typeof fetch;

    await assert.rejects(
      soapRequest(config, 'CreatePatient', createPatientBody),
      (err: Error) => { assertNoPhi(err.message, 'ErrorResponse message'); return true; }
    );
  });

  it('FHIR request errors name the resource path but not the search parameters', async () => {
    const { fhirRequest } = await import('../fhir-client.js');
    const fhirConfig = {
      clientId: 'cid',
      clientSecret: 'csecret',
      baseUrl: 'https://fhir.example.test/fhir-request',
      tokenUrl: 'https://fhir.example.test/oauth/token',
    };
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/oauth/token')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      return new Response('{"resourceType":"OperationOutcome"}', { status: 500 });
    }) as typeof fetch;

    await assert.rejects(
      fhirRequest(fhirConfig, 'Patient', { family: PHI.lastName, birthdate: PHI.dob }),
      (err: Error) => {
        assert.match(err.message, /\/Patient/);
        assertNoPhi(err.message, 'FHIR error message');
        return true;
      }
    );
  });

  it('tebra_get_patient does not echo a malformed patientId', async () => {
    const { handlePatientTool } = await import('../tools/patients.js');
    await assert.rejects(
      handlePatientTool('tebra_get_patient', { patientId: PHI.lastName }, config),
      (err: Error) => { assertNoPhi(err.message, 'validation message'); return true; }
    );
  });
});
