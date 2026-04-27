/**
 * FHIR CarePlan — patient care plans with activities and goals.
 */

import {
  fhirRequest,
  getFhirConfig,
  extractBundleResources,
  formatFhirResult,
  codeDisplay,
  type FhirResource,
} from './helpers.js';

export const fhirCarePlanTools = [
  {
    name: 'tebra_fhir_get_care_plans',
    description:
      'Get patient care plans from Tebra FHIR API. Returns plan title, status, activities, and goals.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
        status: {
          type: 'string',
          enum: ['active', 'completed', 'draft', 'revoked'],
          description: 'Filter by care plan status',
        },
      },
      required: ['patientId'],
    },
  },
];

function summarize(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    intent: r.intent,
    category: Array.isArray(r.category)
      ? (r.category as unknown[]).map((c) => codeDisplay(c))
      : [],
    period: r.period,
    activities: Array.isArray(r.activity)
      ? (r.activity as Array<{ detail?: { code?: unknown; status?: string; description?: string } }>).map((a) => ({
          description: a.detail?.description,
          code: codeDisplay(a.detail?.code),
          status: a.detail?.status,
        }))
      : [],
  };
}

export async function handleFhirCarePlanTool(
  _name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const config = getFhirConfig();
  const patientId = String(args.patientId ?? '');
  if (!patientId) return { content: [{ type: 'text', text: 'patientId is required.' }] };

  const params: Record<string, string> = { patient: patientId };
  if (args.status) params.status = String(args.status);

  const data = await fhirRequest(config, 'CarePlan', params);
  const resources = extractBundleResources(data);
  return formatFhirResult(resources, 'care plans', summarize);
}
