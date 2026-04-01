/**
 * Tebra MCP tools: Bulk patient retrieval with pagination.
 */

import type { TebraConfig } from '../config.js';
import {
  soapRequest,
  escapeXml,
  extractTag,
  extractAllTags,
  extractNumber,
} from '../soap-client.js';

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
        isActive: {
          type: 'boolean',
          description: 'Optional filter: true for active patients only, false for inactive only',
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

  const batchSize = args.batchSize != null ? Number(args.batchSize) : 200;
  const startKey = args.startKey ? String(args.startKey) : undefined;
  const isActive = args.isActive != null ? args.isActive : undefined;

  const fieldsXml = [
    `<kar:BatchSize>${batchSize}</kar:BatchSize>`,
    startKey ? `<kar:StartKey>${escapeXml(startKey)}</kar:StartKey>` : '',
    isActive != null ? `<kar:Active>${isActive ? 'true' : 'false'}</kar:Active>` : '',
  ]
    .filter(Boolean)
    .join('\n        ');

  const bodyXml = `
    <kar:request>
      <kar:Fields>
        ${fieldsXml}
      </kar:Fields>
    </kar:request>`;

  const xml = await soapRequest(config, 'GetAllPatients', bodyXml);
  const blocks = extractAllTags(xml, 'PatientData');
  const nextStartKey = extractTag(xml, 'NextStartKey') || null;

  const patients = blocks.map((block) => ({
    patientId: extractTag(block, 'PatientID') || extractTag(block, 'ID'),
    firstName: extractTag(block, 'FirstName'),
    lastName: extractTag(block, 'LastName'),
    dateOfBirth: extractTag(block, 'DateofBirth') || extractTag(block, 'DOB'),
    mrn: extractTag(block, 'MRN'),
    active: extractTag(block, 'Active'),
    insurances: extractAllTags(block, 'InsurancePolicyData').map((ins) => ({
      payerName: extractTag(ins, 'PayerName') || extractTag(ins, 'CompanyName'),
      memberId: extractTag(ins, 'MemberNumber') || extractTag(ins, 'PolicyNumber'),
      isPrimary: (extractNumber(ins, 'SequenceNumber') || 1) === 1,
    })),
  }));

  const result = {
    patients,
    count: patients.length,
    nextStartKey,
    hasMore: nextStartKey !== null && nextStartKey !== '',
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
