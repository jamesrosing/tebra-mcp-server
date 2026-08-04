/**
 * FHIR Procedure — patient procedure history.
 */

import {
  searchFhir,
  formatFhirResult,
  addDateRange,
  codeDisplay,
  codeValue,
  refDisplay,
  type FhirResource,
} from './helpers.js';

export const fhirProcedureTools = [
  {
    name: 'tebra_fhir_get_procedures',
    description:
      'Get patient procedure history from Tebra FHIR API. Returns procedure name, CPT code, date, and performer.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
        fromDate: {
          type: 'string',
          description: 'Date range start (YYYY-MM-DD)',
        },
        toDate: {
          type: 'string',
          description: 'Date range end (YYYY-MM-DD)',
        },
      },
      required: ['patientId'],
    },
  },
];

function summarize(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    procedure: codeDisplay(r.code),
    code: codeValue(r.code),
    status: r.status,
    performedDateTime: r.performedDateTime,
    performedPeriod: r.performedPeriod,
    performer: Array.isArray(r.performer)
      ? (r.performer as Array<{ actor?: unknown }>).map((p) => refDisplay(p.actor))
      : [],
    reasonCode: Array.isArray(r.reasonCode)
      ? (r.reasonCode as unknown[]).map((c) => codeDisplay(c))
      : [],
  };
}

export async function handleFhirProcedureTool(
  _name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const patientId = String(args.patientId ?? '');
  if (!patientId) return { content: [{ type: 'text', text: 'patientId is required.' }] };

  const params: Record<string, string | string[]> = { patient: patientId };
  addDateRange(params, args);

  const { resources, truncated } = await searchFhir('Procedure', params);
  return formatFhirResult(resources, 'procedures', summarize, truncated);
}
