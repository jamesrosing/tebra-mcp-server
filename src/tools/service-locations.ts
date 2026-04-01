/**
 * Tebra MCP tools: Service location retrieval.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const serviceLocationTools = [
  {
    name: 'tebra_get_service_locations',
    description:
      'Get all service locations (offices/facilities). Required for creating appointments and encounters.',
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

export async function handleServiceLocationTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (name !== 'tebra_get_service_locations') {
    return { content: [{ type: 'text', text: `Unknown service location tool: ${name}` }] };
  }

  const practiceName = args.practiceName ? String(args.practiceName) : undefined;

  const bodyXml = `
    <kar:request>
      <kar:Fields>
        ${practiceName ? `<kar:PracticeName>${escapeXml(practiceName)}</kar:PracticeName>` : ''}
      </kar:Fields>
    </kar:request>`;

  const xml = await soapRequest(config, 'GetServiceLocations', bodyXml);
  const blocks = extractAllTags(xml, 'ServiceLocationData');

  const locations = blocks.map((block) => ({
    serviceLocationId: extractTag(block, 'ID'),
    name: extractTag(block, 'Name'),
    address1: extractTag(block, 'Address1'),
    address2: extractTag(block, 'Address2'),
    city: extractTag(block, 'City'),
    state: extractTag(block, 'State'),
    zipCode: extractTag(block, 'ZipCode'),
    phone: extractTag(block, 'Phone'),
    fax: extractTag(block, 'Fax'),
    npi: extractTag(block, 'NPI'),
    placeOfService: extractTag(block, 'PlaceOfService'),
  }));

  if (locations.length === 0) {
    return {
      content: [{ type: 'text', text: 'No service locations found.' }],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(locations, null, 2) }],
  };
}
