/**
 * FHIR Immunization — patient immunization history.
 */

import {
  fhirRequest,
  getFhirConfig,
  extractBundleResources,
  formatFhirResult,
  codeDisplay,
  refDisplay,
  type FhirResource,
} from './helpers.js';

export const fhirImmunizationTools = [
  {
    name: 'tebra_fhir_get_immunizations',
    description:
      'Get patient immunization history from Tebra FHIR API. Returns vaccine name, date administered, and status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
      },
      required: ['patientId'],
    },
  },
];

function summarize(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    vaccine: codeDisplay(r.vaccineCode),
    status: r.status,
    occurrenceDateTime: r.occurrenceDateTime,
    primarySource: r.primarySource,
    performer: Array.isArray(r.performer)
      ? (r.performer as Array<{ actor?: unknown }>).map((p) => refDisplay(p.actor))
      : [],
  };
}

export async function handleFhirImmunizationTool(
  _name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const config = getFhirConfig();
  const patientId = String(args.patientId ?? '');
  if (!patientId) return { content: [{ type: 'text', text: 'patientId is required.' }] };

  const data = await fhirRequest(config, 'Immunization', { patient: patientId });
  const resources = extractBundleResources(data);
  return formatFhirResult(resources, 'immunizations', summarize);
}
