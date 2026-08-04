/**
 * FHIR DiagnosticReport — patient diagnostic reports (LAB / RAD / PATH).
 */

import {
  searchFhir,
  formatFhirResult,
  codeDisplay,
  refDisplay,
  type FhirResource,
} from './helpers.js';

export const fhirDiagnosticReportTools = [
  {
    name: 'tebra_fhir_get_diagnostic_reports',
    description:
      'Get patient diagnostic reports from Tebra FHIR API. Returns report type, status, conclusion, and linked results.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
        category: {
          type: 'string',
          enum: ['LAB', 'RAD', 'PATH'],
          description: 'Filter by category: LAB=Laboratory, RAD=Radiology, PATH=Pathology',
        },
      },
      required: ['patientId'],
    },
  },
];

function summarize(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    type: codeDisplay(r.code),
    status: r.status,
    category: Array.isArray(r.category)
      ? (r.category as unknown[]).map((c) => codeDisplay(c))
      : [],
    effectiveDateTime: r.effectiveDateTime,
    issued: r.issued,
    conclusion: r.conclusion,
    results: Array.isArray(r.result)
      ? (r.result as unknown[]).map((res) => refDisplay(res))
      : [],
  };
}

export async function handleFhirDiagnosticReportTool(
  _name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const patientId = String(args.patientId ?? '');
  if (!patientId) return { content: [{ type: 'text', text: 'patientId is required.' }] };

  const params: Record<string, string | string[]> = { patient: patientId };
  if (args.category) params.category = String(args.category);

  const { resources, truncated } = await searchFhir('DiagnosticReport', params);
  return formatFhirResult(resources, 'diagnostic reports', summarize, truncated);
}
