/**
 * Minimum-necessary field selection on record-returning tools.
 *
 * Tebra ignores column toggles (CLAUDE.md quirk #4) so projection has to
 * happen client-side, after parsing. Each record tool accepts an optional
 * `fields` list; two tools additionally trim their default output
 * (roster-only for the bulk pull, no policy/group numbers on get_patient).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { pickFields, selectFields, FIELDS_ARG } from '../tools/field-select.js';
import { handlePatientTool } from '../tools/patients.js';
import { handleBulkPatientTool } from '../tools/bulk-patients.js';
import { handleTransactionTool } from '../tools/transactions.js';
import type { TebraConfig } from '../config.js';

const config: TebraConfig = {
  user: 'svc@example.com',
  password: 'pw',
  customerKey: 'ck-123',
  endpoint: 'https://example.test/soap',
};

const envelope = (inner: string) =>
  new Response(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${inner}</s:Body></s:Envelope>`, { status: 200 });

const text = (r: { content: Array<{ text: string }> }) => r.content[0].text;

describe('pickFields', () => {
  const record = {
    patientId: '1', firstName: 'A', cases: [{ caseId: 'c1', policies: [{ companyName: 'X', policyNumber: 'P' }] }],
  };

  it('keeps only the named top-level keys', () => {
    assert.deepEqual(pickFields(record, ['patientId']), { patientId: '1' });
  });

  it('descends dotted paths through arrays', () => {
    assert.deepEqual(pickFields(record, ['cases.policies.companyName']), {
      cases: [{ policies: [{ companyName: 'X' }] }],
    });
  });

  it('ignores unknown paths rather than throwing', () => {
    assert.deepEqual(pickFields(record, ['nope', 'patientId']), { patientId: '1' });
  });
});

describe('selectFields', () => {
  it('returns records untouched when no fields are requested', () => {
    const rows = [{ a: 1, b: 2 }];
    assert.equal(selectFields(rows, undefined), rows);
  });

  it('rejects a non-array fields argument with a clear error', () => {
    assert.throws(() => selectFields([{ a: 1 }], 'a'), /fields must be an array/);
  });

  it('exposes a reusable schema property', () => {
    assert.equal(FIELDS_ARG.fields.type, 'array');
  });
});

describe('field selection on record tools', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  const patientXml =
    '<GetPatientResponse><GetPatientResult><Patient>' +
    '<ID>4242</ID><FirstName>Zel</FirstName><LastName>Quorvax</LastName><DOB>1961-07-19</DOB>' +
    '<MobilePhone>555-014-9921</MobilePhone><EmailAddress>z@example.net</EmailAddress>' +
    '<Cases><PatientCaseData><PatientCaseID>9</PatientCaseID><Name>Default</Name>' +
    '<Policies><PatientInsurancePolicyData><CompanyName>Acme Health</CompanyName>' +
    '<Number>POL-88ZQ</Number><GroupNumber>GRP-12</GroupNumber><Copay>20</Copay>' +
    '</PatientInsurancePolicyData></Policies></PatientCaseData></Cases>' +
    '</Patient></GetPatientResult></GetPatientResponse>';

  it('tebra_get_patient omits policy and group numbers unless asked for', async () => {
    globalThis.fetch = (async () => envelope(patientXml)) as typeof fetch;
    const out = JSON.parse(text(await handlePatientTool('tebra_get_patient', { patientId: '4242' }, config)));
    assert.equal(out.cases[0].policies[0].companyName, 'Acme Health');
    assert.equal(out.cases[0].policies[0].copay, '20');
    assert.equal('policyNumber' in out.cases[0].policies[0], false);
    assert.equal('groupNumber' in out.cases[0].policies[0], false);
    assert.equal(out.mobilePhone, '555-014-9921');
  });

  it('tebra_get_patient returns policy numbers when explicitly requested', async () => {
    globalThis.fetch = (async () => envelope(patientXml)) as typeof fetch;
    const out = JSON.parse(text(await handlePatientTool(
      'tebra_get_patient', { patientId: '4242', fields: ['patientId', 'cases.policies.policyNumber'] }, config)));
    assert.deepEqual(out, { patientId: '4242', cases: [{ policies: [{ policyNumber: 'POL-88ZQ' }] }] });
  });

  it('tebra_get_all_patients defaults to roster identifiers only', async () => {
    globalThis.fetch = (async () => envelope(
      '<GetAllPatientsResponse><GetAllPatientsResult><Patients><PatientBatchData>' +
      '<ID>1</ID><FirstName>Zel</FirstName><LastName>Quorvax</LastName><DOB>1961-07-19</DOB>' +
      '<MedicalRecordNumber>MRN1</MedicalRecordNumber><Active>true</Active><Gender>F</Gender>' +
      '<MobilePhone>555-014-9921</MobilePhone><EmailAddress>z@example.net</EmailAddress>' +
      '</PatientBatchData></Patients><Key><nextStartKey>0</nextStartKey></Key>' +
      '</GetAllPatientsResult></GetAllPatientsResponse>')) as typeof fetch;
    const out = JSON.parse(text(await handleBulkPatientTool('tebra_get_all_patients', {}, config)));
    assert.deepEqual(out.patients, [
      { patientId: '1', firstName: 'Zel', lastName: 'Quorvax', dateOfBirth: '1961-07-19', mrn: 'MRN1', active: 'true' },
    ]);
    assert.equal(out.count, 1);
  });

  it('tebra_get_transactions honors an explicit fields list', async () => {
    globalThis.fetch = (async () => envelope(
      '<GetTransactionsResponse><GetTransactionsResult><Transactions><TransactionData>' +
      '<ID>7</ID><PatientFullName>Zel Quorvax</PatientFullName><Amount>12.50</Amount>' +
      '</TransactionData></Transactions></GetTransactionsResult></GetTransactionsResponse>')) as typeof fetch;
    const out = JSON.parse(text(await handleTransactionTool(
      'tebra_get_transactions', { fields: ['transactionId', 'amount'] }, config)));
    assert.deepEqual(out, [{ transactionId: '7', amount: '12.50' }]);
  });
});
