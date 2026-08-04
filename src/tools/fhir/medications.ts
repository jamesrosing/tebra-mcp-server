/**
 * FHIR MedicationRequest — patient medication orders.
 */

import {
  searchFhir,
  formatFhirResult,
  codeDisplay,
  refDisplay,
  type FhirResource,
} from './helpers.js';

export const fhirMedicationTools = [
  {
    name: 'tebra_fhir_get_medications',
    description:
      'Get patient medication requests from Tebra FHIR API. Returns medication name, dosage, status, and prescriber.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
        status: {
          type: 'string',
          enum: ['active', 'completed', 'stopped'],
          description: 'Filter by medication status',
        },
        intent: {
          type: 'string',
          description: "MedicationRequest intent (Tebra requires this search param; default 'order')",
        },
      },
      required: ['patientId'],
    },
  },
];

function summarize(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    medication: codeDisplay(r.medicationCodeableConcept) || refDisplay(r.medicationReference),
    status: r.status,
    intent: r.intent,
    authoredOn: r.authoredOn,
    requester: refDisplay(r.requester),
    dosageInstructions: Array.isArray(r.dosageInstruction)
      ? (r.dosageInstruction as Array<{ text?: string }>).map((d) => d.text).filter(Boolean)
      : [],
  };
}

export async function handleFhirMedicationTool(
  _name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const patientId = String(args.patientId ?? '');
  if (!patientId) return { content: [{ type: 'text', text: 'patientId is required.' }] };

  // Tebra requires the intent param alongside patient — omitting it returns
  // a silent empty bundle (FHIR API User Guide, search parameter tables).
  const params: Record<string, string | string[]> = {
    patient: patientId,
    intent: args.intent ? String(args.intent) : 'order',
  };
  if (args.status) params.status = String(args.status);

  const { resources, truncated } = await searchFhir('MedicationRequest', params);
  return formatFhirResult(resources, 'medications', summarize, truncated);
}
