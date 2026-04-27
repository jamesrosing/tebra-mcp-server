/**
 * FHIR Observation (laboratory category) — lab results with reference ranges.
 */

import {
  fhirRequest,
  getFhirConfig,
  extractBundleResources,
  formatFhirResult,
  addDateRange,
  summarizeObservation,
} from './helpers.js';

export const fhirLabResultsTools = [
  {
    name: 'tebra_fhir_get_lab_results',
    description:
      'Get patient laboratory results from Tebra FHIR API. Returns test name, value, units, reference ranges.',
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
        code: {
          type: 'string',
          description: 'LOINC code to filter by',
        },
      },
      required: ['patientId'],
    },
  },
];

export async function handleFhirLabResultsTool(
  _name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const config = getFhirConfig();
  const patientId = String(args.patientId ?? '');
  if (!patientId) return { content: [{ type: 'text', text: 'patientId is required.' }] };

  const params: Record<string, string> = {
    patient: patientId,
    category: 'laboratory',
  };
  addDateRange(params, args);
  if (args.code) params.code = String(args.code);

  const data = await fhirRequest(config, 'Observation', params);
  const resources = extractBundleResources(data);
  return formatFhirResult(resources, 'lab results', summarizeObservation);
}
