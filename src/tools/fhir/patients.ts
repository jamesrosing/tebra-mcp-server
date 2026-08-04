/**
 * FHIR Patient — patient lookup on the FHIR side.
 *
 * Every other FHIR tool requires a FHIR patient ID, which is not the same
 * identifier space as the SOAP PatientID. This tool is the bridge: search
 * by name/birthdate/identifier, read the `id` off the result, and feed it
 * to the clinical tools.
 */

import {
  searchFhir,
  formatFhirResult,
  type FhirResource,
} from './helpers.js';

export const fhirPatientTools = [
  {
    name: 'tebra_fhir_search_patients',
    description:
      'Search patients in the Tebra FHIR API by name, birthdate, or identifier. Returns FHIR patient IDs — required by every other tebra_fhir_* tool (FHIR IDs differ from SOAP patient IDs). Provide at least one search parameter.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Name to search (matches given and family names)',
        },
        family: {
          type: 'string',
          description: 'Family (last) name',
        },
        given: {
          type: 'string',
          description: 'Given (first) name',
        },
        birthdate: {
          type: 'string',
          description: 'Date of birth (YYYY-MM-DD)',
        },
        identifier: {
          type: 'string',
          description: 'Patient identifier (e.g. MRN)',
        },
        fhirId: {
          type: 'string',
          description: 'Direct FHIR resource ID lookup (_id search)',
        },
      },
      required: [],
    },
  },
];

function summarize(r: FhirResource): Record<string, unknown> {
  const names = Array.isArray(r.name)
    ? (r.name as Array<{ family?: string; given?: string[]; text?: string }>)
    : [];
  const primaryName = names[0];
  const telecoms = Array.isArray(r.telecom)
    ? (r.telecom as Array<{ system?: string; value?: string }>)
    : [];
  const identifiers = Array.isArray(r.identifier)
    ? (r.identifier as Array<{ system?: string; value?: string }>)
    : [];

  return {
    fhirPatientId: r.id,
    name: primaryName?.text ?? `${primaryName?.given?.join(' ') ?? ''} ${primaryName?.family ?? ''}`.trim(),
    birthDate: r.birthDate,
    gender: r.gender,
    phone: telecoms.find((t) => t.system === 'phone')?.value,
    email: telecoms.find((t) => t.system === 'email')?.value,
    identifiers: identifiers.map((i) => ({ system: i.system, value: i.value })),
    active: r.active,
  };
}

export async function handleFhirPatientTool(
  _name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const params: Record<string, string | string[]> = {};
  if (args.name) params.name = String(args.name);
  if (args.family) params.family = String(args.family);
  if (args.given) params.given = String(args.given);
  if (args.birthdate) params.birthdate = String(args.birthdate);
  if (args.identifier) params.identifier = String(args.identifier);
  if (args.fhirId) params._id = String(args.fhirId);

  if (Object.keys(params).length === 0) {
    return {
      content: [{ type: 'text', text: 'At least one search parameter is required (name, family, given, birthdate, identifier, or fhirId).' }],
    };
  }

  const { resources, truncated } = await searchFhir('Patient', params);
  return formatFhirResult(resources, 'patients', summarize, truncated);
}
