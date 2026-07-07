/**
 * Regression tests for the GetCharges request body and response parser.
 *
 * Guards two production failures:
 * 1. Filter criteria placed inside <kar:Fields> are silently skipped by WCF —
 *    every GetCharges call in package history before 0.3.0 was unfiltered.
 * 2. Explicit boolean column toggles in <kar:Fields> trigger an empty
 *    projection server-side (quirk #4, hit live by 0.3.0): responses carry one
 *    phantom empty ChargeData block. Fields must be an empty element, and the
 *    parser must drop rows with no charge ID.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGetChargesRequestBody, parseChargesResponse } from '../tools/charges.js';

test('filter criteria land inside <kar:Filter>', () => {
  const body = buildGetChargesRequestBody({
    fromPostingDate: '2025-07-06',
    toPostingDate: '2026-07-06',
    status: 'Error - Rejection',
  });

  const filterMatch = body.match(/<kar:Filter>([\s\S]*?)<\/kar:Filter>/);
  assert.ok(filterMatch, 'populated Filter block must be present');
  const filter = filterMatch[1];

  assert.match(filter, /<kar:FromPostingDate>2025-07-06<\/kar:FromPostingDate>/);
  assert.match(filter, /<kar:ToPostingDate>2026-07-06<\/kar:ToPostingDate>/);
  assert.match(filter, /<kar:Status>Error - Rejection<\/kar:Status>/);
});

test('Fields is emitted as an empty element — explicit toggles trigger the empty-projection quirk (#4)', () => {
  const body = buildGetChargesRequestBody({ status: 'Pending' });
  assert.match(body, /<kar:Fields \/>/, 'Fields must be an empty element');
  assert.doesNotMatch(
    body,
    /<kar:Fields>[\s\S]*?<\/kar:Fields>/,
    'Fields must not contain column toggles'
  );
});

test('Filter members appear in WSDL sequence order', () => {
  const body = buildGetChargesRequestBody({
    status: 'Pending',
    fromPostingDate: '2025-07-06',
    toPostingDate: '2026-07-06',
    procedureCode: '14301',
    encounterStatus: 'Approved',
  });
  const filter = body.match(/<kar:Filter>([\s\S]*?)<\/kar:Filter>/)![1];
  const order = ['EncounterStatus', 'FromPostingDate', 'ProcedureCode', 'Status', 'ToPostingDate'];
  const positions = order.map((name) => filter.indexOf(`<kar:${name}>`));
  for (const [i, pos] of positions.entries()) {
    assert.notEqual(pos, -1, `${order[i]} missing from Filter`);
  }
  for (let i = 1; i < positions.length; i++) {
    assert.ok(
      positions[i] > positions[i - 1],
      `WSDL order violated: ${order[i]} must come after ${order[i - 1]}`
    );
  }
});

test('includeUnapprovedCharges serializes as T/F string in the Filter', () => {
  const withTrue = buildGetChargesRequestBody({ includeUnapprovedCharges: true });
  assert.match(
    withTrue.match(/<kar:Filter>([\s\S]*?)<\/kar:Filter>/)![1],
    /<kar:IncludeUnapprovedCharges>T<\/kar:IncludeUnapprovedCharges>/
  );

  const withFalse = buildGetChargesRequestBody({ includeUnapprovedCharges: false });
  assert.match(
    withFalse.match(/<kar:Filter>([\s\S]*?)<\/kar:Filter>/)![1],
    /<kar:IncludeUnapprovedCharges>F<\/kar:IncludeUnapprovedCharges>/
  );
});

test('no criteria -> self-closing <kar:Filter /> still emitted (wire-format quirk #3)', () => {
  const body = buildGetChargesRequestBody({});
  assert.match(body, /<kar:Filter \/>/);
  assert.doesNotMatch(body, /<kar:Filter>[\s\S]*<\/kar:Filter>/);
});

test('patientId throws instead of silently not filtering (fail closed)', () => {
  assert.throws(
    () => buildGetChargesRequestBody({ patientId: '12345' }),
    /patientName/,
    'unsupported filter args must error, not silently return unfiltered data'
  );
});

test('parser drops the phantom empty ChargeData block', () => {
  const xml = `
    <GetChargesResponse>
      <Charges>
        <ChargeData>
          <ID></ID>
          <PatientName></PatientName>
          <Status></Status>
        </ChargeData>
      </Charges>
    </GetChargesResponse>`;
  const charges = parseChargesResponse(xml);
  assert.equal(charges.length, 0, 'a ChargeData block with no ID is not a charge');
});

test('parser maps a real ChargeData block', () => {
  const xml = `
    <GetChargesResponse>
      <Charges>
        <ChargeData>
          <ID>98765</ID>
          <PatientID>111</PatientID>
          <PatientName>DOE, JANE</PatientName>
          <ProcedureCode>14060</ProcedureCode>
          <ServiceStartDate>6/2/2026</ServiceStartDate>
          <Status>Error - Rejection</Status>
          <TotalCharges>1200.00</TotalCharges>
          <PrimaryInsuranceCompanyName>Cigna</PrimaryInsuranceCompanyName>
          <PrimaryInsuranceInsurancePayment>0.00</PrimaryInsuranceInsurancePayment>
          <PrimaryInsuranceInsuranceAllowed>0.00</PrimaryInsuranceInsuranceAllowed>
        </ChargeData>
      </Charges>
    </GetChargesResponse>`;
  const charges = parseChargesResponse(xml);
  assert.equal(charges.length, 1);
  assert.equal(charges[0].chargeId, '98765');
  assert.equal(charges[0].status, 'Error - Rejection');
  assert.equal(charges[0].payer, 'Cigna');
  assert.equal(charges[0].totalCharges, '1200.00');
  assert.equal(charges[0].allowedAmount, '0.00');
});
