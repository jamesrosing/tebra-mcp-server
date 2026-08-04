/**
 * FHIR CareTeam — patient care team members and roles.
 */

import {
  searchFhir,
  formatFhirResult,
  codeDisplay,
  refDisplay,
  type FhirResource,
} from './helpers.js';

export const fhirCareTeamTools = [
  {
    name: 'tebra_fhir_get_care_team',
    description:
      'Get patient care team from Tebra FHIR API. Returns team members with roles.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
        status: {
          type: 'string',
          enum: ['proposed', 'active', 'suspended', 'inactive', 'entered-in-error'],
          description: "Care team status (Tebra requires this search param; default 'active')",
        },
      },
      required: ['patientId'],
    },
  },
];

function summarize(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    participants: Array.isArray(r.participant)
      ? (r.participant as Array<{ role?: unknown[]; member?: unknown }>).map((p) => ({
          role: p.role?.map((role: unknown) => codeDisplay(role)),
          member: refDisplay(p.member),
        }))
      : [],
  };
}

export async function handleFhirCareTeamTool(
  _name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const patientId = String(args.patientId ?? '');
  if (!patientId) return { content: [{ type: 'text', text: 'patientId is required.' }] };

  // Tebra requires the status param alongside patient — omitting it returns
  // a silent empty bundle (FHIR API User Guide, search parameter tables).
  const { resources, truncated } = await searchFhir('CareTeam', {
    patient: patientId,
    status: args.status ? String(args.status) : 'active',
  });
  return formatFhirResult(resources, 'care team records', summarize, truncated);
}
