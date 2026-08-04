/**
 * Tebra MCP tools: Bulk patient retrieval with pagination.
 *
 * GetAllPatientsReq = { Fields: PatientBatchFieldsToReturn, Filter:
 * PatientBatchGetFilter } where the filter carries the paging controls
 * (WSDL sequence: BatchSize → PracticeID → StartKey). The response is
 * PatientBatchData blocks plus a Key block whose nextStartKey member
 * drives the next page. There is no server-side active/inactive filter —
 * isActive is applied client-side after parsing.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';

// ─── Request Body Builder (exported for tests) ──────────────────

export function buildGetAllPatientsBody(args: Record<string, unknown>): string {
  const requested = args.batchSize != null ? Number(args.batchSize) : 200;
  // Clamp to the documented 1–1000 range instead of trusting the input.
  const batchSize = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 1000) : 200;
  const startKey = args.startKey ? String(args.startKey) : '';
  const practiceId = args.practiceId ? String(args.practiceId) : '';

  // PatientBatchGetFilter WSDL sequence: BatchSize → PracticeID → StartKey.
  return `
    <kar:request>
      <kar:Fields />
      <kar:Filter>
        <kar:BatchSize>${batchSize}</kar:BatchSize>
        ${practiceId ? `<kar:PracticeID>${escapeXml(practiceId)}</kar:PracticeID>` : ''}
        ${startKey ? `<kar:StartKey>${escapeXml(startKey)}</kar:StartKey>` : ''}
      </kar:Filter>
    </kar:request>`;
}

// ─── Tool Definitions ───────────────────────────────────────────

export const bulkPatientTools = [
  {
    name: 'tebra_get_all_patients',
    description:
      'Get all patients in bulk with pagination. Returns a page of patients and a continuation key for the next page. Use startKey from the previous response to get the next batch.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        batchSize: {
          type: 'number',
          description: 'Number of patients per page (default 200, max 1000)',
        },
        startKey: {
          type: 'string',
          description: 'Continuation key from previous response (omit for first page)',
        },
        practiceId: {
          type: 'string',
          description: 'Optional practice ID filter',
        },
        isActive: {
          type: 'boolean',
          description: 'Optional filter: true for active patients only, false for inactive only (applied client-side; the returned count reflects the filtered page)',
        },
      },
      required: [],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleBulkPatientTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (name !== 'tebra_get_all_patients') {
    return { content: [{ type: 'text', text: `Unknown bulk patient tool: ${name}` }] };
  }

  const bodyXml = buildGetAllPatientsBody(args);
  const xml = await soapRequest(config, 'GetAllPatients', bodyXml);
  const blocks = extractAllTags(xml, 'PatientBatchData');
  const keyBlock = extractTag(xml, 'Key');
  const nextStartKey = keyBlock ? extractTag(keyBlock, 'nextStartKey') : '';

  let patients = blocks
    .map((block) => ({
      patientId: extractTag(block, 'ID'),
      firstName: extractTag(block, 'FirstName'),
      lastName: extractTag(block, 'LastName'),
      dateOfBirth: extractTag(block, 'DOB'),
      mrn: extractTag(block, 'MedicalRecordNumber'),
      active: extractTag(block, 'Active'),
      gender: extractTag(block, 'Gender'),
      mobilePhone: extractTag(block, 'MobilePhone'),
      email: extractTag(block, 'EmailAddress'),
      practiceName: extractTag(block, 'PracticeName'),
      primaryInsurance: extractTag(block, 'PrimaryInsurancePolicyCompanyName'),
      secondaryInsurance: extractTag(block, 'SecondaryInsurancePolicyCompanyName'),
    }))
    // Drop the phantom placeholder block Tebra emits on empty result sets.
    .filter((patient) => patient.patientId !== '');

  if (args.isActive != null) {
    const want = args.isActive ? 'true' : 'false';
    patients = patients.filter((p) => p.active.toLowerCase() === want);
  }

  const result = {
    patients,
    count: patients.length,
    nextStartKey: nextStartKey || null,
    hasMore: nextStartKey !== '' && nextStartKey !== '0',
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
