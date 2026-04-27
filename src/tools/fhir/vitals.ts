/**
 * FHIR Observation (vital-signs category) — BP, HR, temp, weight, height, BMI, SpO2.
 */

import {
  fhirRequest,
  getFhirConfig,
  extractBundleResources,
  formatFhirResult,
  addDateRange,
  summarizeObservation,
} from './helpers.js';

export const fhirVitalsTools = [
  {
    name: 'tebra_fhir_get_vitals',
    description:
      'Get patient vital signs from Tebra FHIR API. Returns BP, HR, temp, weight, height, BMI, SpO2, etc.',
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

export async function handleFhirVitalsTool(
  _name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const config = getFhirConfig();
  const patientId = String(args.patientId ?? '');
  if (!patientId) return { content: [{ type: 'text', text: 'patientId is required.' }] };

  const params: Record<string, string> = {
    patient: patientId,
    category: 'vital-signs',
  };
  addDateRange(params, args);

  const data = await fhirRequest(config, 'Observation', params);
  const resources = extractBundleResources(data);
  return formatFhirResult(resources, 'vital signs', summarizeObservation);
}
