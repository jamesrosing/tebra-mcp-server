/**
 * Pins MCP tool annotations to the upstream Tebra operation each tool
 * performs. The hints are derived from the tool-name verb, so a badly
 * named tool (a "get" that writes, a "create" that reads) would ship
 * with the wrong readOnlyHint — this table is the independent oracle.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { annotateTools, annotationsFor, titleFor } from '../tool-annotations.js';
import { allSoapTools, allFhirTools } from '../tool-registry.js';

// What each tool actually does upstream, classified by side-effect.
const READ_ONLY = new Set([
  'tebra_search_patients', 'tebra_get_patient', 'tebra_get_all_patients',
  'tebra_get_patient_authorizations', 'tebra_check_insurance_eligibility',
  'tebra_get_encounter', 'tebra_get_appointments', 'tebra_get_appointment_detail',
  'tebra_get_appointment_reasons', 'tebra_get_charges', 'tebra_get_payments',
  'tebra_get_transactions', 'tebra_get_providers', 'tebra_get_service_locations',
  'tebra_get_practices', 'tebra_get_procedure_codes', 'tebra_get_external_vendors',
  'tebra_validate_connection', 'tebra_get_throttles',
  'tebra_fhir_search_patients', 'tebra_fhir_get_allergies', 'tebra_fhir_get_medications',
  'tebra_fhir_get_conditions', 'tebra_fhir_get_vitals', 'tebra_fhir_get_lab_results',
  'tebra_fhir_get_immunizations', 'tebra_fhir_get_procedures', 'tebra_fhir_get_care_plans',
  'tebra_fhir_get_care_team', 'tebra_fhir_get_diagnostic_reports', 'tebra_fhir_get_documents',
  'tebra_fhir_get_devices',
]);
// Additive writes: a retry creates a duplicate.
const CREATES = new Set([
  'tebra_create_patient', 'tebra_create_encounter', 'tebra_create_appointment',
  'tebra_create_payment', 'tebra_create_document', 'tebra_register_external_vendor',
  'tebra_create_appointment_reason',
]);
// In-place updates: re-sending the same request converges on the same state.
const IDEMPOTENT_UPDATES = new Set([
  'tebra_update_patient', 'tebra_update_encounter_status', 'tebra_update_appointment',
  'tebra_update_appointment_status', 'tebra_update_patient_external_id',
  'tebra_set_primary_patient_case',
]);
const DELETES = new Set(['tebra_delete_appointment', 'tebra_delete_document']);

const allTools = [...allSoapTools, ...allFhirTools];

describe('tool registry', () => {
  it('registers 34 SOAP + 13 FHIR tools with unique names', () => {
    assert.equal(allSoapTools.length, 34);
    assert.equal(allFhirTools.length, 13);
    assert.equal(new Set(allTools.map((t) => t.name)).size, 47);
  });

  it('classifies every tool exactly once', () => {
    const classified = new Set([...READ_ONLY, ...CREATES, ...IDEMPOTENT_UPDATES, ...DELETES]);
    assert.deepEqual([...classified].sort(), allTools.map((t) => t.name).sort());
    assert.equal(READ_ONLY.size + CREATES.size + IDEMPOTENT_UPDATES.size + DELETES.size, 47);
  });

  it('keeps every tool name within the 64-character limit', () => {
    for (const t of allTools) assert.ok(t.name.length <= 64, t.name);
  });
});

describe('annotationsFor', () => {
  it('marks read-only tools readOnlyHint=true and nothing destructive', () => {
    for (const name of READ_ONLY) {
      assert.deepEqual(annotationsFor(name), { readOnlyHint: true, openWorldHint: true }, name);
    }
  });

  it('marks creates as non-idempotent writes', () => {
    for (const name of CREATES) {
      assert.deepEqual(annotationsFor(name),
        { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, name);
    }
  });

  it('marks updates as idempotent, non-destructive writes', () => {
    for (const name of IDEMPOTENT_UPDATES) {
      assert.deepEqual(annotationsFor(name),
        { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, name);
    }
  });

  it('marks deletes as destructive and idempotent', () => {
    for (const name of DELETES) {
      assert.deepEqual(annotationsFor(name),
        { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }, name);
    }
  });
});

describe('titleFor', () => {
  it('builds a human title from the name and tags FHIR tools', () => {
    assert.equal(titleFor('tebra_get_patient_authorizations'), 'Get Patient Authorizations');
    assert.equal(titleFor('tebra_fhir_get_lab_results'), 'Get Lab Results (FHIR)');
  });

  it('spells the ID initialism in upper case', () => {
    assert.equal(titleFor('tebra_update_patient_external_id'), 'Update Patient External ID');
  });
});

describe('annotateTools', () => {
  it('sets title and annotations on every tool without touching schemas', () => {
    const annotated = annotateTools(allTools);
    assert.equal(annotated.length, allTools.length);
    for (const t of annotated) {
      assert.equal(t.title, titleFor(t.name));
      assert.equal(t.annotations.title, titleFor(t.name));
      assert.equal(t.annotations.readOnlyHint, READ_ONLY.has(t.name));
      assert.ok(t.inputSchema, t.name);
    }
  });
});
