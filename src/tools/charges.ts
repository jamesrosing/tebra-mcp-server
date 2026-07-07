/**
 * Tebra MCP tools: Charge retrieval.
 *
 * Request body layout is bound to the WSDL sequence order (xsd0):
 *   GetChargesReq → Fields (ChargeFieldsToReturn: boolean column toggles, minOccurs=1)
 *                 → Filter (ChargeFilter: string criteria, minOccurs=0 but required
 *                   in practice — see wire-format quirk #3 in CLAUDE.md)
 * WCF deserializes sequences in declared order and silently skips out-of-order
 * or unknown members, so both blocks below MUST stay in WSDL order.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';

// ─── WSDL Sequence Tables (source of truth: ?xsd=xsd0) ─────────

/**
 * Columns requested from ChargeFieldsToReturn, in WSDL sequence order.
 * Do not reorder. Do not add names not present in the WSDL type.
 */
const FIELDS_TO_RETURN: readonly string[] = [
  'EncounterID',
  'EncounterStatus',
  'ID',
  'InsuranceBalance',
  'PatientBalance',
  'PatientID',
  'PatientName',
  'PostingDate',
  'PrimaryInsuranceAdjudicationDate',
  'PrimaryInsuranceCompanyName',
  'PrimaryInsuranceInsuranceContractAdjustment',
  'PrimaryInsuranceInsuranceContractAdjustmentReason',
  'PrimaryInsuranceInsurancePayment',
  'PrimaryInsuranceInsuranceSecondaryAdjustment',
  'PrimaryInsuranceInsuranceSecondaryAdjustmentReason',
  'PrimaryInsurancePlanName',
  'ProcedureCode',
  'ProcedureModifier1',
  'ProcedureName',
  'RenderingProviderName',
  'ServiceStartDate',
  'Status',
  'TotalBalance',
  'TotalCharges',
];

/**
 * [MCP arg key, ChargeFilter element] in WSDL sequence order.
 * ChargeFilter has no PatientID member — filtering by patient uses PatientName.
 */
const FILTER_SEQUENCE: ReadonlyArray<readonly [string, string]> = [
  ['batchNumber', 'BatchNumber'],
  ['billedTo', 'BilledTo'],
  ['casePayerScenario', 'CasePayerScenario'],
  ['diagnosisCode', 'DiagnosisCode'],
  ['encounterStatus', 'EncounterStatus'],
  ['fromCreatedDate', 'FromCreatedDate'],
  ['fromLastModifiedDate', 'FromLastModifiedDate'],
  ['fromPostingDate', 'FromPostingDate'],
  ['fromDate', 'FromServiceDate'],
  ['includeUnapprovedCharges', 'IncludeUnapprovedCharges'],
  ['patientName', 'PatientName'],
  ['procedureCode', 'ProcedureCode'],
  ['renderingProviderName', 'RenderingProviderFullName'],
  ['status', 'Status'],
  ['toCreatedDate', 'ToCreatedDate'],
  ['toLastModifiedDate', 'ToLastModifiedDate'],
  ['toPostingDate', 'ToPostingDate'],
  ['toDate', 'ToServiceDate'],
];

// ─── Request Body Builder (exported for tests) ──────────────────

export function buildGetChargesRequestBody(args: Record<string, unknown>): string {
  // Fail closed on args that have no ChargeFilter member. Silently ignoring a
  // filter is how this tool spent its whole life returning unfiltered data.
  if (args['patientId'] !== undefined && args['patientId'] !== null && args['patientId'] !== '') {
    throw new Error(
      "tebra_get_charges: 'patientId' is not a ChargeFilter member in the Tebra WSDL; " +
        "filter by 'patientName' instead."
    );
  }

  const filterParts: string[] = [];
  for (const [argKey, element] of FILTER_SEQUENCE) {
    const raw = args[argKey];
    if (raw === undefined || raw === null || raw === '') continue;
    // IncludeUnapprovedCharges is xs:string in ChargeFilter; Tebra expects 'T'/'F'.
    const val = argKey === 'includeUnapprovedCharges' ? (raw ? 'T' : 'F') : String(raw);
    filterParts.push(`<kar:${element}>${escapeXml(val)}</kar:${element}>`);
  }

  const fieldsXml = FIELDS_TO_RETURN.map(
    (name) => `<kar:${name}>true</kar:${name}>`
  ).join('\n        ');

  const filterXml =
    filterParts.length > 0
      ? `<kar:Filter>\n        ${filterParts.join('\n        ')}\n      </kar:Filter>`
      : '<kar:Filter />';

  return `
    <kar:request>
      <kar:Fields>
        ${fieldsXml}
      </kar:Fields>
      ${filterXml}
    </kar:request>`;
}

// ─── Tool Definitions ───────────────────────────────────────────

export const chargeTools = [
  {
    name: 'tebra_get_charges',
    description:
      'Get charges from Tebra with flexible filters: date range, patient name, provider, procedure/diagnosis codes, billing status, encounter status, and more. Returns charge details with payer, adjudication, adjustment reasons, amounts, and balances.',
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
        patientName: {
          type: 'string',
          description: 'Patient full name to filter by (ChargeFilter has no patient ID member)',
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
          description: "Charge status filter (e.g. 'Denied')",
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

  const bodyXml = buildGetChargesRequestBody(args);
  const xml = await soapRequest(config, 'GetCharges', bodyXml);
  const blocks = extractAllTags(xml, 'ChargeData');

  const charges = blocks.map((block) => ({
    chargeId: extractTag(block, 'ID'),
    encounterId: extractTag(block, 'EncounterID'),
    encounterStatus: extractTag(block, 'EncounterStatus'),
    patientId: extractTag(block, 'PatientID'),
    patientName: extractTag(block, 'PatientName'),
    procedureCode: extractTag(block, 'ProcedureCode'),
    procedureName: extractTag(block, 'ProcedureName'),
    modifier1: extractTag(block, 'ProcedureModifier1'),
    serviceDate: extractTag(block, 'ServiceStartDate'),
    postingDate: extractTag(block, 'PostingDate'),
    status: extractTag(block, 'Status'),
    totalCharges: extractTag(block, 'TotalCharges'),
    totalBalance: extractTag(block, 'TotalBalance'),
    insuranceBalance: extractTag(block, 'InsuranceBalance'),
    patientBalance: extractTag(block, 'PatientBalance'),
    payer: extractTag(block, 'PrimaryInsuranceCompanyName'),
    planName: extractTag(block, 'PrimaryInsurancePlanName'),
    adjudicationDate: extractTag(block, 'PrimaryInsuranceAdjudicationDate'),
    insurancePayment: extractTag(block, 'PrimaryInsuranceInsurancePayment'),
    contractAdjustment: extractTag(block, 'PrimaryInsuranceInsuranceContractAdjustment'),
    adjustmentReason: extractTag(block, 'PrimaryInsuranceInsuranceContractAdjustmentReason'),
    secondaryAdjustmentReason: extractTag(block, 'PrimaryInsuranceInsuranceSecondaryAdjustmentReason'),
    renderingProvider: extractTag(block, 'RenderingProviderName'),
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
