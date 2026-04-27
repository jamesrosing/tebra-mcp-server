/**
 * FHIR Condition — patient diagnoses / problem list.
 */

import {
  fhirRequest,
  getFhirConfig,
  extractBundleResources,
  formatFhirResult,
  codeDisplay,
  codeValue,
  type FhirResource,
} from './helpers.js';

export const fhirConditionTools = [
  {
    name: 'tebra_fhir_get_conditions',
    description:
      'Get patient conditions/diagnoses from Tebra FHIR API. Returns condition name, ICD code, clinical status, and onset date.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
        clinicalStatus: {
          type: 'string',
          enum: ['active', 'resolved', 'inactive'],
          description: 'Filter by clinical status',
        },
      },
      required: ['patientId'],
    },
  },
];

function summarize(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    condition: codeDisplay(r.code),
    code: codeValue(r.code),
    clinicalStatus: codeDisplay(r.clinicalStatus),
    verificationStatus: codeDisplay(r.verificationStatus),
    category: Array.isArray(r.category)
      ? (r.category as unknown[]).map((c) => codeDisplay(c))
      : [],
    onsetDateTime: r.onsetDateTime,
    abatementDateTime: r.abatementDateTime,
    recordedDate: r.recordedDate,
  };
}

export async function handleFhirConditionTool(
  _name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const config = getFhirConfig();
  const patientId = String(args.patientId ?? '');
  if (!patientId) return { content: [{ type: 'text', text: 'patientId is required.' }] };

  const params: Record<string, string> = { patient: patientId };
  if (args.clinicalStatus) params['clinical-status'] = String(args.clinicalStatus);

  const data = await fhirRequest(config, 'Condition', params);
  const resources = extractBundleResources(data);
  return formatFhirResult(resources, 'conditions', summarize);
}
