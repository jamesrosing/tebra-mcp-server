/**
 * Tebra MCP tools: Provider retrieval.
 *
 * Criteria go in <kar:Filter> in WSDL ProviderFilter sequence order —
 * see filter-helpers.ts.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, extractTag, extractAllTags } from '../soap-client.js';
import { buildListGetBody, type FilterSequence } from './filter-helpers.js';

// ─── WSDL Sequence Table (source of truth: ?xsd=xsd0 ProviderFilter) ──

const PROVIDER_FILTER_SEQUENCE: FilterSequence = [
  ['departmentName', 'DepartmentName'],
  ['fromCreatedDate', 'FromCreatedDate'],
  ['fromLastModifiedDate', 'FromLastModifiedDate'],
  ['fullName', 'FullName'],
  ['practiceId', 'PracticeID'],
  ['practiceName', 'PracticeName'],
  ['toCreatedDate', 'ToCreatedDate'],
  ['toLastModifiedDate', 'ToLastModifiedDate'],
  ['type', 'Type'],
];

// ─── Request Body Builder (exported for tests) ──────────────────

export function buildGetProvidersBody(args: Record<string, unknown>): string {
  return buildListGetBody(PROVIDER_FILTER_SEQUENCE, args);
}

// ─── Tool Definitions ───────────────────────────────────────────

export const providerTools = [
  {
    name: 'tebra_get_providers',
    description:
      'Get providers with IDs, names, specialties, NPI, and active status. Optionally filter by full name, practice, department, or provider type. Used to resolve provider names to IDs for appointments and encounters.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fullName: {
          type: 'string',
          description: 'Optional provider full name filter',
        },
        practiceName: {
          type: 'string',
          description: 'Optional practice name filter',
        },
        practiceId: {
          type: 'string',
          description: 'Optional practice ID filter',
        },
        departmentName: {
          type: 'string',
          description: 'Optional department name filter',
        },
        type: {
          type: 'string',
          description: 'Optional provider type filter',
        },
      },
      required: [],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleProviderTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (name !== 'tebra_get_providers') {
    return { content: [{ type: 'text', text: `Unknown provider tool: ${name}` }] };
  }

  const bodyXml = buildGetProvidersBody(args);
  const xml = await soapRequest(config, 'GetProviders', bodyXml);
  const blocks = extractAllTags(xml, 'ProviderData');

  const providers = blocks
    .map((block) => ({
      providerId: extractTag(block, 'ID'),
      firstName: extractTag(block, 'FirstName'),
      lastName: extractTag(block, 'LastName'),
      fullName: extractTag(block, 'FullName'),
      degree: extractTag(block, 'Degree'),
      npi: extractTag(block, 'NationalProviderIdentifier'),
      specialtyName: extractTag(block, 'SpecialtyName'),
      departmentName: extractTag(block, 'DepartmentName'),
      billingType: extractTag(block, 'BillingType'),
      type: extractTag(block, 'Type'),
      active: extractTag(block, 'Active'),
      email: extractTag(block, 'EmailAddress'),
      workPhone: extractTag(block, 'WorkPhone'),
      practiceName: extractTag(block, 'PracticeName'),
    }))
    // Drop the phantom placeholder block Tebra emits on empty result sets.
    .filter((provider) => provider.providerId !== '');

  if (providers.length === 0) {
    return {
      content: [{ type: 'text', text: 'No providers found.' }],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(providers, null, 2) }],
  };
}
