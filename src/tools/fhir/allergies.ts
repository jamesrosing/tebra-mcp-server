/**
 * FHIR AllergyIntolerance — patient allergies and intolerances.
 */

import {
  fhirRequest,
  getFhirConfig,
  extractBundleResources,
  formatFhirResult,
  codeDisplay,
  type FhirResource,
} from './helpers.js';

export const fhirAllergyTools = [
  {
    name: 'tebra_fhir_get_allergies',
    description:
      'Get patient allergy and intolerance data from Tebra FHIR API. Returns substance, clinical status, criticality, and reactions.',
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
    substance: codeDisplay(r.code),
    clinicalStatus: codeDisplay(r.clinicalStatus),
    verificationStatus: codeDisplay(r.verificationStatus),
    type: r.type,
    category: r.category,
    criticality: r.criticality,
    recordedDate: r.recordedDate,
    reactions: Array.isArray(r.reaction)
      ? (r.reaction as Array<{ manifestation?: unknown[]; severity?: string }>).map((rx) => ({
          manifestations: rx.manifestation?.map((m: unknown) => codeDisplay(m)) ?? [],
          severity: rx.severity,
        }))
      : [],
  };
}

export async function handleFhirAllergyTool(
  _name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const config = getFhirConfig();
  const patientId = String(args.patientId ?? '');
  if (!patientId) return { content: [{ type: 'text', text: 'patientId is required.' }] };

  const data = await fhirRequest(config, 'AllergyIntolerance', { patient: patientId });
  const resources = extractBundleResources(data);
  return formatFhirResult(resources, 'allergies', summarize);
}
