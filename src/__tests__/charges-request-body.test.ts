/**
 * Regression tests for the GetCharges request body and response parsing.
 *
 * Two WCF quirks are pinned here:
 * 1. Fields/Filter misplacement: filter criteria placed inside <kar:Fields>
 *    are silently skipped by WCF (unknown members of ChargeFieldsToReturn).
 *    Criteria belong in <kar:Filter>, in WSDL sequence order.
 * 2. Projection inversion: ANY explicit <kar:X>true</kar:X> toggle set makes
 *    Tebra return ONE empty <ChargeData/> placeholder per call — zero real
 *    fields regardless of filter matches (verified live 2026-07-07 against a
 *    12-month window set; same quirk documented for GetPatients). Only an
 *    empty <kar:Fields/> returns the full record, including the
 *    PrimaryInsurance* adjudication columns this tool exists to surface.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGetChargesRequestBody, parseChargeBlocks } from '../tools/charges.js';

test('filter criteria land inside <kar:Filter>, never inside <kar:Fields>', () => {
  const body = buildGetChargesRequestBody({
    fromPostingDate: '2025-07-06',
    toPostingDate: '2026-07-06',
    status: 'Denied',
  });

  const filterMatch = body.match(/<kar:Filter>([\s\S]*?)<\/kar:Filter>/);
  assert.ok(filterMatch, 'populated Filter block must be present');
  const filter = filterMatch[1];

  assert.match(filter, /<kar:FromPostingDate>2025-07-06<\/kar:FromPostingDate>/);
  assert.match(filter, /<kar:ToPostingDate>2026-07-06<\/kar:ToPostingDate>/);
  assert.match(filter, /<kar:Status>Denied<\/kar:Status>/);
});

test('<kar:Fields> is EMPTY — explicit toggles trigger the WCF empty-projection quirk', () => {
  const body = buildGetChargesRequestBody({ status: 'Denied' });
  assert.match(body, /<kar:Fields\s*\/>/, 'Fields must be self-closing (full-record projection)');
  assert.doesNotMatch(
    body,
    /<kar:Fields>[\s\S]*?<\/kar:Fields>/,
    'explicit column toggles return one empty ChargeData placeholder live — never send them'
  );
});

test('parseChargeBlocks drops the phantom empty <ChargeData/> placeholder', () => {
  const xml = `
    <GetChargesResult>
      <Charges>
        <ChargeData/>
        <ChargeData>
          <ID>59611</ID>
          <ProcedureCode>14060</ProcedureCode>
          <Status>Error - Rejection</Status>
          <TotalCharges>1200.0000</TotalCharges>
          <PrimaryInsuranceCompanyName>Cigna</PrimaryInsuranceCompanyName>
          <PrimaryInsuranceInsurancePayment>0.0000</PrimaryInsuranceInsurancePayment>
        </ChargeData>
      </Charges>
    </GetChargesResult>`;
  const charges = parseChargeBlocks(xml);
  assert.equal(charges.length, 1, 'empty placeholder block must be filtered out');
  assert.equal(charges[0].chargeId, '59611');
  assert.equal(charges[0].status, 'Error - Rejection');
  assert.equal(charges[0].totalCharges, '1200.0000');
  assert.equal(charges[0].payer, 'Cigna');
});

test('parseChargeBlocks returns [] for a no-match response (single empty placeholder)', () => {
  const xml = '<GetChargesResult><Charges><ChargeData/></Charges></GetChargesResult>';
  assert.deepEqual(parseChargeBlocks(xml), []);
});

test('Filter members appear in WSDL sequence order', () => {
  const body = buildGetChargesRequestBody({
    status: 'Denied',
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

test('no criteria → self-closing <kar:Filter /> still emitted (wire-format quirk #3)', () => {
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
