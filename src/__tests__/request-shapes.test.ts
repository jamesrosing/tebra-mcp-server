/**
 * Regression tests for SOAP request-body shapes, verified against the live
 * WSDL (KareoServices.svc?xsd=xsd0 / ?xsd=xsd7, fetched 2026-08-03).
 *
 * Three invariants matter for every list-GET (see CLAUDE.md quirks):
 *   1. <kar:Fields /> is EMPTY (toggles trigger the empty-projection quirk).
 *   2. Criteria live inside <kar:Filter>, in WSDL sequence order.
 *   3. Args with no WSDL Filter member fail closed instead of silently
 *      returning unfiltered data.
 *
 * Write ops must match their WSDL wrapper element and member order exactly —
 * WCF's DataContractSerializer silently drops out-of-order/unknown members.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractTag } from '../soap-client.js';
import { buildSearchPatientsBody, buildGetPatientBody } from '../tools/patients.js';
import { buildGetAppointmentsBody } from '../tools/appointments.js';
import { buildGetPaymentsBody, buildCreatePaymentBody } from '../tools/payments.js';
import { buildGetTransactionsBody } from '../tools/transactions.js';
import { buildGetProvidersBody } from '../tools/providers.js';
import { buildGetServiceLocationsBody } from '../tools/service-locations.js';
import { buildGetProcedureCodesBody } from '../tools/procedure-codes.js';
import { buildGetAllPatientsBody } from '../tools/bulk-patients.js';
import { buildGetEncounterBody, buildCreateEncounterBody } from '../tools/encounters.js';
import { buildUpdateEncounterStatusBody } from '../tools/encounter-status.js';
import { buildCreateAppointmentBody, buildUpdateAppointmentBody } from '../tools/appointment-crud.js';
import { buildCreatePatientBody, buildUpdatePatientBody } from '../tools/patient-crud.js';
import { buildCreateDocumentBody } from '../tools/documents.js';
import { buildUpdateExternalIdBody } from '../tools/external-ids.js';
import { addDateRange } from '../tools/fhir/helpers.js';

function assertOrder(xml: string, elements: string[], label: string): void {
  const positions = elements.map((el) => xml.indexOf(`<kar:${el}>`));
  for (const [i, pos] of positions.entries()) {
    assert.notEqual(pos, -1, `${label}: <kar:${elements[i]}> missing`);
  }
  for (let i = 1; i < positions.length; i++) {
    assert.ok(
      positions[i] > positions[i - 1],
      `${label}: WSDL order violated — ${elements[i]} must come after ${elements[i - 1]}`
    );
  }
}

function filterBlock(body: string): string {
  const match = body.match(/<kar:Filter>([\s\S]*?)<\/kar:Filter>/);
  assert.ok(match, 'populated <kar:Filter> block must be present');
  return match![1];
}

// ─── GetPatients ────────────────────────────────────────────────

test('search_patients: criteria in Filter, empty Fields, WSDL order', () => {
  const body = buildSearchPatientsBody({
    firstName: 'Jane', lastName: 'Doe', isActive: true,
    insuranceCompanyName: 'Cigna', toDateOfBirth: '1990-12-31',
  });
  assert.match(body, /<kar:Fields \/>/);
  const filter = filterBlock(body);
  assertOrder(filter, ['FirstName', 'IsActive', 'LastName', 'PrimaryInsurancePolicyCompanyName', 'ToDateOfBirth'], 'PatientFilter');
});

test('search_patients: exact dateOfBirth becomes [DOB, DOB+1) — ToDateOfBirth is exclusive', () => {
  const filter = filterBlock(buildSearchPatientsBody({ dateOfBirth: '1985-06-15' }));
  assert.match(filter, /<kar:FromDateOfBirth>1985-06-15<\/kar:FromDateOfBirth>/);
  assert.match(filter, /<kar:ToDateOfBirth>1985-06-16<\/kar:ToDateOfBirth>/);
});

test('search_patients: query is an alias for FullName', () => {
  const filter = filterBlock(buildSearchPatientsBody({ query: 'Jane Doe' }));
  assert.match(filter, /<kar:FullName>Jane Doe<\/kar:FullName>/);
});

test('search_patients: mrn and externalId fail closed (no PatientFilter member)', () => {
  assert.throws(() => buildSearchPatientsBody({ mrn: '123' }), /mrn/);
  assert.throws(() => buildSearchPatientsBody({ externalId: 'X1' }), /tebra_get_patient/);
});

// ─── GetPatient (SinglePatientFilter) ───────────────────────────

test('get_patient: Filter-only request — the WSDL GetPatientReq has no Fields member', () => {
  const body = buildGetPatientBody({ patientId: '4127' });
  assert.doesNotMatch(body, /<kar:Fields/);
  assert.match(body, /<kar:Filter>[\s\S]*<kar:PatientID>4127<\/kar:PatientID>[\s\S]*<\/kar:Filter>/);
});

test('get_patient: ExternalID precedes ExternalVendorID precedes PatientID', () => {
  const body = buildGetPatientBody({ patientId: '4127', externalId: 'EXT9', externalVendorId: '2' });
  assertOrder(body, ['ExternalID', 'ExternalVendorID', 'PatientID'], 'SinglePatientFilter');
});

test('get_patient: requires an ID and rejects non-numeric patientId', () => {
  assert.throws(() => buildGetPatientBody({}), /patientId or externalId/);
  assert.throws(() => buildGetPatientBody({ patientId: 'abc' }), /numeric/);
});

// ─── GetAppointments ────────────────────────────────────────────

test('get_appointments: dates and filters in Filter, WSDL order', () => {
  const body = buildGetAppointmentsBody({
    startDate: '2026-08-01', endDate: '2026-08-31',
    patientFullName: 'DOE, JANE', appointmentType: 'P', confirmationStatus: 'Confirmed',
  });
  assert.match(body, /<kar:Fields \/>/);
  const filter = filterBlock(body);
  assertOrder(filter, ['ConfirmationStatus', 'EndDate', 'PatientFullName', 'StartDate', 'Type'], 'AppointmentFilter');
});

test('get_appointments: providerId fails closed (no AppointmentFilter member)', () => {
  assert.throws(
    () => buildGetAppointmentsBody({ startDate: '2026-08-01', endDate: '2026-08-31', providerId: '1' }),
    /resourceName/
  );
});

// ─── GetPayments / CreatePayment ────────────────────────────────

test('get_payments: criteria in Filter, WSDL order; patientId fails closed', () => {
  const filter = filterBlock(buildGetPaymentsBody({
    batchNumber: 'B12', fromPostDate: '2026-07-01', payerName: 'Cigna', toPostDate: '2026-07-31',
  }));
  assertOrder(filter, ['BatchNumber', 'FromPostDate', 'PayerName', 'ToPostDate'], 'PaymentFilter');
  assert.throws(() => buildGetPaymentsBody({ patientId: '5' }), /patientId/);
});

test('create_payment: amount and method ride inside the nested Payment group', () => {
  const body = buildCreatePaymentBody({ patientId: '4127', amount: 150, paymentMethod: 'Check', referenceNumber: '1001' });
  const payment = extractTag(body.replace(/kar:/g, ''), 'Payment');
  assert.match(payment, /<AmountPaid>150<\/AmountPaid>/);
  assert.match(payment, /<PaymentMethod>Check<\/PaymentMethod>/);
  assertOrder(body, ['Patient', 'PayerType', 'Payment'], 'PaymentCreate');
});

// ─── GetTransactions ────────────────────────────────────────────

test('get_transactions: transactionType maps to the WSDL Type member', () => {
  const filter = filterBlock(buildGetTransactionsBody({ transactionType: 'Adjustment', fromServiceDate: '2026-07-01' }));
  assert.match(filter, /<kar:Type>Adjustment<\/kar:Type>/);
  assert.doesNotMatch(filter, /<kar:TransactionType>/);
  assertOrder(filter, ['FromServiceDate', 'Type'], 'TransactionFilter');
});

// ─── Config-table GETs ──────────────────────────────────────────

test('get_providers: criteria in Filter (xsd0 namespace)', () => {
  assert.match(filterBlock(buildGetProvidersBody({ practiceName: 'Allure' })), /<kar:PracticeName>Allure<\/kar:PracticeName>/);
});

test('get_service_locations / get_procedure_codes: xsd7 members use the kar7 (no-trailing-slash) namespace', () => {
  // Verified live 2026-08-03: kar:-prefixed Fields/Filter on these two ops
  // fault with "Expecting element 'Fields'" — xsd7's targetNamespace lacks
  // the trailing slash, so its members are different XML names.
  const sl = buildGetServiceLocationsBody({ practiceName: 'Allure' });
  assert.match(sl, /<kar7:Fields \/>/);
  assert.match(sl, /<kar7:Filter>[\s\S]*<kar7:PracticeName>Allure<\/kar7:PracticeName>[\s\S]*<\/kar7:Filter>/);
  assert.match(sl, /<kar:request>/, 'the request wrapper itself stays in the xsd0 namespace');

  const pc = buildGetProcedureCodesBody({ searchTerm: '99213' });
  assert.match(pc, /<kar7:Fields \/>/);
  assert.match(pc, /<kar7:ProcedureCode>99213<\/kar7:ProcedureCode>/);
  assert.doesNotMatch(pc, /<kar7:Code>/);

  const empty = buildGetServiceLocationsBody({});
  assert.match(empty, /<kar7:Filter \/>/);
});

// ─── GetAllPatients ─────────────────────────────────────────────

test('get_all_patients: paging controls in Filter (BatchSize → PracticeID → StartKey)', () => {
  const body = buildGetAllPatientsBody({ batchSize: 100, startKey: '500', practiceId: '1' });
  assert.match(body, /<kar:Fields \/>/);
  assertOrder(filterBlock(body), ['BatchSize', 'PracticeID', 'StartKey'], 'PatientBatchGetFilter');
});

// ─── Encounters ─────────────────────────────────────────────────

test('get_encounter: EncounterID lives in Filter, not Fields', () => {
  const body = buildGetEncounterBody({ encounterId: '789' });
  assert.match(body, /<kar:Fields \/>/);
  assert.match(filterBlock(body), /<kar:EncounterID>789<\/kar:EncounterID>/);
});

test('create_encounter: ServiceLines carry DiagnosisCode1-4 per line, WSDL member order', () => {
  const body = buildCreateEncounterBody({
    patientId: '4127', providerId: '11', serviceDate: '2026-08-01',
    practiceName: 'Allure', serviceLocationId: '3',
    diagnoses: [{ code: 'L91.0' }, { code: 'Z42.8' }],
    procedures: [{ code: '14060', modifiers: ['59'], units: 1 }],
  });
  assert.match(body, /<kar:ServiceLineReq>/);
  assert.match(body, /<kar:DiagnosisCode1>L91.0<\/kar:DiagnosisCode1>/);
  assert.match(body, /<kar:DiagnosisCode2>Z42.8<\/kar:DiagnosisCode2>/);
  assert.match(body, /<kar:ProcedureModifier1>59<\/kar:ProcedureModifier1>/);
  // Strip per-line internals so the order check sees only encounter-level members.
  const encounterLevel = body.replace(/<kar:ServiceLineReq>[\s\S]*?<\/kar:ServiceLineReq>/g, '');
  assertOrder(encounterLevel, ['EncounterStatus', 'Patient', 'Practice', 'RenderingProvider', 'ServiceEndDate', 'ServiceLines', 'ServiceLocation', 'ServiceStartDate'], 'EncounterCreate');
  // Per-line order: DiagnosisCode1 → ProcedureCode → ServiceEndDate → ServiceStartDate → Units.
  const line = body.match(/<kar:ServiceLineReq>[\s\S]*?<\/kar:ServiceLineReq>/)![0];
  assertOrder(line, ['DiagnosisCode1', 'ProcedureCode', 'ServiceEndDate', 'ServiceStartDate', 'Units'], 'ServiceLineReq');
  // Old (broken) shape must be gone.
  assert.doesNotMatch(body, /<kar:EncounterDiagnoses>/);
  assert.doesNotMatch(body, /<kar:EncounterProcedures>/);
});

test('update_encounter_status: EncounterUpdateStatus wrapper with EncounterStatus member', () => {
  const body = buildUpdateEncounterStatusBody({ encounterId: '789', status: 'Approved', practiceName: 'Allure' });
  assert.match(body, /<kar:EncounterUpdateStatus>/);
  assert.match(body, /<kar:EncounterStatus>Approved<\/kar:EncounterStatus>/);
  assert.doesNotMatch(body, /<kar:Status>/);
  assertOrder(body, ['EncounterID', 'EncounterStatus', 'Practice'], 'EncounterUpdateStatus');
});

// ─── Appointment CRUD ───────────────────────────────────────────

test('create_appointment: flat AppointmentCreate shape with PatientSummary and StartTime/EndTime', () => {
  const body = buildCreateAppointmentBody({
    patientId: '4127', providerId: '11', serviceLocationId: '3',
    startDate: '2026-08-05T09:00:00', duration: 30, appointmentReasonId: '2',
  });
  assert.match(body, /<kar:PatientSummary>[\s\S]*<kar:PatientId>4127<\/kar:PatientId>[\s\S]*<\/kar:PatientSummary>/);
  assert.match(body, /<kar:StartTime>2026-08-05T09:00:00<\/kar:StartTime>/);
  assert.match(body, /<kar:EndTime>2026-08-05T09:30:00<\/kar:EndTime>/);
  assertOrder(body, ['AppointmentReasonId', 'AppointmentStatus', 'AppointmentType', 'EndTime', 'PatientSummary', 'ProviderId', 'ServiceLocationId', 'StartTime'], 'AppointmentCreate');
  // Old (broken) nested-identifier shape must be gone.
  assert.doesNotMatch(body, /<kar:Patient>/);
  assert.doesNotMatch(body, /<kar:Provider>/);
  assert.doesNotMatch(body, /<kar:Duration>/);
});

test('create_appointment: requires endDate or duration', () => {
  assert.throws(
    () => buildCreateAppointmentBody({ patientId: '1', providerId: '2', serviceLocationId: '3', startDate: '2026-08-05T09:00:00' }),
    /endDate or duration/
  );
});

test('update_appointment: AppointmentId first, confirmationStatus aliases to AppointmentStatus', () => {
  const body = buildUpdateAppointmentBody({ appointmentId: '99', confirmationStatus: 'CheckedIn' });
  assert.match(body, /<kar:AppointmentId>99<\/kar:AppointmentId>/);
  assert.match(body, /<kar:AppointmentStatus>CheckedIn<\/kar:AppointmentStatus>/);
});

// ─── Patient CRUD ───────────────────────────────────────────────

test('create_patient: members in WSDL sequence order with correct names', () => {
  const body = buildCreatePatientBody({
    firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1990-01-15',
    address1: '1 Main St', city: 'Newport', state: 'CA', zipCode: '92660',
    email: 'j@example.com', gender: 'Female', ssn: '123-45-6789',
    externalId: 'EXT1', practiceName: 'Allure',
    primaryInsurance: { companyName: 'Cigna', memberId: 'M1', groupNumber: 'G1' },
    guarantor: { firstName: 'John', lastName: 'Doe', relationship: 'Spouse' },
  });
  assertOrder(body, ['AddressLine1', 'Cases', 'City', 'DateofBirth', 'EmailAddress', 'FirstName', 'Gender', 'Guarantor', 'LastName', 'PatientExternalID', 'Practice', 'SocialSecurityNumber', 'State', 'ZipCode'], 'PatientCreate');
  assert.doesNotMatch(body, /<kar:SSN>/);
  assert.doesNotMatch(body, /<kar:ExternalID>EXT1/);
  // Insurance rides inside Cases → Policies with PolicyNumber/PolicyGroupNumber.
  assert.match(body, /<kar:Cases>[\s\S]*<kar:InsurancePolicyCreateReq>[\s\S]*<kar:PolicyNumber>M1<\/kar:PolicyNumber>[\s\S]*<\/kar:Cases>/);
  assert.match(body, /<kar:RelationshiptoGuarantor>Spouse<\/kar:RelationshiptoGuarantor>/);
});

test('update_patient: PatientID positioned after contact fields per WSDL order', () => {
  const body = buildUpdatePatientBody({ patientId: '4127', firstName: 'Jane', mobilePhone: '9495551212', zipCode: '92660' });
  assertOrder(body, ['FirstName', 'MobilePhone', 'PatientID', 'ZipCode'], 'PatientUpdate');
});

// ─── Documents ──────────────────────────────────────────────────

test('create_document: DocumentToCreate wrapper in WSDL member order', () => {
  const body = buildCreateDocumentBody({
    patientId: '4127', documentLabel: 'Operative Report', fileName: 'op.pdf', fileContent: 'QUJD',
  });
  assert.match(body, /<kar:DocumentToCreate>/);
  assert.doesNotMatch(body, /<kar:Document>/);
  // Label normalized to the enum's no-spaces form.
  assert.match(body, /<kar:Label>OperativeReport<\/kar:Label>/);
  assertOrder(body, ['FileContent', 'FileName', 'Label', 'Name', 'PatientId', 'Status'], 'DocumentCreateRequest');
});

// ─── External IDs ───────────────────────────────────────────────

test('update_patient_external_id: batch wrapper with camelCase setting members', () => {
  const body = buildUpdateExternalIdBody({ patientId: '4127', externalId: 'EXT1', externalVendorId: '2' });
  assert.match(body, /<kar:Updates>[\s\S]*<kar:UpdateBatch>[\s\S]*<kar:PatientExternalIDSetting>/);
  assertOrder(body, ['externalID', 'externalVendorID', 'patientID'], 'PatientExternalIDSetting');
});

// ─── FHIR helpers ───────────────────────────────────────────────

test('fhir addDateRange: from+to produces two repeated date params, not one concatenated value', () => {
  const params: Record<string, string | string[]> = {};
  addDateRange(params, { fromDate: '2026-01-01', toDate: '2026-06-30' });
  assert.deepEqual(params.date, ['ge2026-01-01', 'le2026-06-30']);

  const single: Record<string, string | string[]> = {};
  addDateRange(single, { fromDate: '2026-01-01' });
  assert.equal(single.date, 'ge2026-01-01');
});

// ─── XML helper hardening ───────────────────────────────────────

test('extractTag requires a tag-name boundary (Patient does not match PatientData)', () => {
  const xml = '<PatientData><ID>1</ID></PatientData><Patient><ID>2</ID></Patient>';
  assert.equal(extractTag(extractTag(xml, 'Patient'), 'ID'), '2');
});
