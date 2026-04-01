/**
 * Tebra MCP tools: Charge retrieval.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const chargeTools = [
  {
    name: 'tebra_get_charges',
    description:
      'Get charges from Tebra with flexible filters: date range, patient, provider, procedure/diagnosis codes, billing status, encounter status, and more. Returns charge details with payment status, amounts, and balances.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fromDate: {
          type: 'string',
          description: 'Service start date filter (ISO 8601)',
        },
        toDate: {
          type: 'string',
          description: 'Service end date filter (ISO 8601)',
        },
        patientId: {
          type: 'string',
          description: 'Tebra patient ID to filter by',
        },
        fromPostingDate: {
          type: 'string',
          description: 'Posting date range start (YYYY-MM-DD)',
        },
        toPostingDate: {
          type: 'string',
          description: 'Posting date range end (YYYY-MM-DD)',
        },
        batchNumber: {
          type: 'string',
          description: 'Filter by batch number',
        },
        renderingProviderName: {
          type: 'string',
          description: 'Rendering provider full name',
        },
        procedureCode: {
          type: 'string',
          description: 'Filter by CPT procedure code',
        },
        diagnosisCode: {
          type: 'string',
          description: 'Filter by ICD diagnosis code',
        },
        status: {
          type: 'string',
          description: 'Charge status filter',
        },
        billedTo: {
          type: 'string',
          description: 'Billed-to entity filter',
        },
        includeUnapprovedCharges: {
          type: 'boolean',
          description: 'Include unapproved charges (default false)',
        },
        encounterStatus: {
          type: 'string',
          enum: ['Draft', 'Review', 'Approved', 'Rejected'],
          description: 'Encounter status filter',
        },
        casePayerScenario: {
          type: 'string',
          description: 'Case payer scenario filter',
        },
        fromLastModifiedDate: {
          type: 'string',
          description: 'Modified date range start (YYYY-MM-DD)',
        },
        toLastModifiedDate: {
          type: 'string',
          description: 'Modified date range end (YYYY-MM-DD)',
        },
        fromCreatedDate: {
          type: 'string',
          description: 'Created date range start (YYYY-MM-DD)',
        },
        toCreatedDate: {
          type: 'string',
          description: 'Created date range end (YYYY-MM-DD)',
        },
      },
      required: [],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleChargeTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (name !== 'tebra_get_charges') {
    return { content: [{ type: 'text', text: `Unknown charge tool: ${name}` }] };
  }

  // Map of arg names to SOAP filter field names
  const stringFilterMap: Array<[string, string]> = [
    ['fromDate', 'FromServiceDate'],
    ['toDate', 'ToServiceDate'],
    ['patientId', 'PatientID'],
    ['fromPostingDate', 'FromPostingDate'],
    ['toPostingDate', 'ToPostingDate'],
    ['batchNumber', 'BatchNumber'],
    ['renderingProviderName', 'RenderingProviderFullName'],
    ['procedureCode', 'ProcedureCode'],
    ['diagnosisCode', 'DiagnosisCode'],
    ['status', 'Status'],
    ['billedTo', 'BilledTo'],
    ['encounterStatus', 'EncounterStatus'],
    ['casePayerScenario', 'CasePayerScenario'],
    ['fromLastModifiedDate', 'FromLastModifiedDate'],
    ['toLastModifiedDate', 'ToLastModifiedDate'],
    ['fromCreatedDate', 'FromCreatedDate'],
    ['toCreatedDate', 'ToCreatedDate'],
  ];

  const filterFields: string[] = [];
  for (const [argKey, soapField] of stringFilterMap) {
    const val = args[argKey];
    if (val !== undefined && val !== null && val !== '') {
      filterFields.push(`<kar:${soapField}>${escapeXml(String(val))}</kar:${soapField}>`);
    }
  }

  // Boolean: includeUnapprovedCharges -> "T" / "F"
  if (args.includeUnapprovedCharges !== undefined && args.includeUnapprovedCharges !== null) {
    const boolVal = args.includeUnapprovedCharges ? 'T' : 'F';
    filterFields.push(`<kar:IncludeUnapprovedCharges>${boolVal}</kar:IncludeUnapprovedCharges>`);
  }

  const fieldsXml = filterFields.join('\n        ');

  const bodyXml = `
    <kar:request>
      <kar:Fields>
        ${fieldsXml}
      </kar:Fields>
    </kar:request>`;

  const xml = await soapRequest(config, 'GetCharges', bodyXml);
  const blocks = extractAllTags(xml, 'ChargeData');

  const charges = blocks.map((block) => ({
    chargeId: extractTag(block, 'ChargeID') || extractTag(block, 'ID'),
    patientId: extractTag(block, 'PatientID'),
    patientName: extractTag(block, 'PatientFullName'),
    procedureCode: extractTag(block, 'ProcedureCode'),
    diagnosisCode: extractTag(block, 'DiagnosisCode1'),
    serviceDate: extractTag(block, 'ServiceStartDate'),
    amount: extractTag(block, 'Amount'),
    balance: extractTag(block, 'Balance'),
    paymentStatus: extractTag(block, 'PaymentStatus') || extractTag(block, 'Status'),
    providerName: extractTag(block, 'ProviderFullName'),
  }));

  if (charges.length === 0) {
    return {
      content: [{ type: 'text', text: 'No charges found matching the specified filters.' }],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(charges, null, 2) }],
  };
}
