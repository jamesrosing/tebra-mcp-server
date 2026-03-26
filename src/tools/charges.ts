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
      'Get charges from Tebra with optional date range and patient filters. Returns charge details with payment status, amounts, and balances.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fromDate: {
          type: 'string',
          description: 'Start date filter (ISO 8601)',
        },
        toDate: {
          type: 'string',
          description: 'End date filter (ISO 8601)',
        },
        patientId: {
          type: 'string',
          description: 'Optional Tebra patient ID to filter by',
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

  const fromDate = args.fromDate ? String(args.fromDate) : undefined;
  const toDate = args.toDate ? String(args.toDate) : undefined;
  const patientId = args.patientId ? String(args.patientId) : undefined;

  const fieldsXml = [
    fromDate ? `<kar:FromServiceDate>${escapeXml(fromDate)}</kar:FromServiceDate>` : '',
    toDate ? `<kar:ToServiceDate>${escapeXml(toDate)}</kar:ToServiceDate>` : '',
    patientId ? `<kar:PatientID>${escapeXml(patientId)}</kar:PatientID>` : '',
  ]
    .filter(Boolean)
    .join('\n        ');

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
