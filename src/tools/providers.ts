/**
 * Tebra MCP tools: Provider retrieval.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const providerTools = [
  {
    name: 'tebra_get_providers',
    description:
      'Get all providers with IDs, names, specialties, NPI, and active status. Used to resolve provider names to IDs for appointments and encounters.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        practiceName: {
          type: 'string',
          description: 'Optional practice name filter',
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

  const practiceName = args.practiceName ? String(args.practiceName) : undefined;

  const bodyXml = `
    <kar:request>
      <kar:Fields>
        ${practiceName ? `<kar:PracticeName>${escapeXml(practiceName)}</kar:PracticeName>` : ''}
      </kar:Fields>
    </kar:request>`;

  const xml = await soapRequest(config, 'GetProviders', bodyXml);
  const blocks = extractAllTags(xml, 'ProviderData');

  const providers = blocks.map((block) => ({
    providerId: extractTag(block, 'ID'),
    firstName: extractTag(block, 'FirstName'),
    lastName: extractTag(block, 'LastName'),
    fullName: extractTag(block, 'FullName'),
    npi: extractTag(block, 'NPI'),
    specialtyName: extractTag(block, 'SpecialtyName'),
    departmentName: extractTag(block, 'DepartmentName'),
    billingType: extractTag(block, 'BillingType'),
    active: extractTag(block, 'Active'),
    email: extractTag(block, 'Email'),
    phone: extractTag(block, 'Phone'),
  }));

  if (providers.length === 0) {
    return {
      content: [{ type: 'text', text: 'No providers found.' }],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(providers, null, 2) }],
  };
}
