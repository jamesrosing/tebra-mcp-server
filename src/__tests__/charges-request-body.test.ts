/**
 * Regression tests for the GetCharges request body.
 *
 * Guards against the Fields/Filter misplacement bug: filter criteria placed
 * inside <kar:Fields> are silently skipped by WCF (unknown members of
 * ChargeFieldsToReturn) — or worse, collide with a boolean column toggle
 * ('Denied' cannot be parsed as Boolean). Criteria belong in <kar:Filter>,
 * in WSDL sequence order.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGetChargesRequestBody } from '../tools/charges.js';

function fieldsBlock(body: string): string {
  const m = body.match(/<kar:Fields>([\s\S]*?)<\/kar:Fields>/);
  assert.ok(m, 'Fields block must be present (minOccurs=1 in GetChargesReq)');
  return m[1];
}

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

  const fields = fieldsBlock(body);
  assert.doesNotMatch(fields, /Denied/, 'criteria must not leak into Fields');
  assert.doesNotMatch(fields, /2025-07-06/, 'criteria must not leak into Fields');
});

test('<kar:Fields> contains only boolean column toggles set to true', () => {
  const body = buildGetChargesRequestBody({ status: 'Denied' });
  const fields = fieldsBlock(body);
  const values = [...fields.matchAll(/<kar:[A-Za-z0-9]+>([^<]*)<\/kar:/g)].map((m) => m[1]);
  assert.ok(values.length > 0, 'Fields must request explicit columns');
  for (const v of values) {
    assert.equal(v, 'true', `Fields toggle value must be 'true', got '${v}'`);
  }
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
