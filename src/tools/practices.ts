/**
 * Tebra MCP tools: Practice retrieval.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, extractTag, extractAllTags } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const practiceTools = [
  {
    name: 'tebra_get_practices',
    description:
      'Get all practices associated with the Tebra account. Returns practice IDs, names, NPI, tax ID, and contact info.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handlePracticeTool(
  name: string,
  _args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (name !== 'tebra_get_practices') {
    return { content: [{ type: 'text', text: `Unknown practice tool: ${name}` }] };
  }

  const bodyXml = `
    <kar:request>
      <kar:Fields />
    </kar:request>`;

  const xml = await soapRequest(config, 'GetPractices', bodyXml);
  const blocks = extractAllTags(xml, 'PracticeData');

  const practices = blocks.map((block) => ({
    practiceId: extractTag(block, 'ID'),
    practiceName: extractTag(block, 'PracticeName'),
    active: extractTag(block, 'Active'),
    npi: extractTag(block, 'NPI'),
    taxId: extractTag(block, 'TaxID'),
    address: extractTag(block, 'Address'),
    phone: extractTag(block, 'Phone'),
    fax: extractTag(block, 'Fax'),
    email: extractTag(block, 'Email'),
    webSite: extractTag(block, 'WebSite'),
    subscriptionEdition: extractTag(block, 'SubscriptionEdition'),
  }));

  if (practices.length === 0) {
    return {
      content: [{ type: 'text', text: 'No practices found.' }],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(practices, null, 2) }],
  };
}
