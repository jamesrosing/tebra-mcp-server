/**
 * Tebra MCP tools: Service location retrieval.
 *
 * Criteria go in <kar:Filter> in WSDL ServiceLocationFilter sequence order
 * (source: ?xsd=xsd7) — see filter-helpers.ts.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, extractTag, extractAllTags } from '../soap-client.js';
import { buildListGetBody, type FilterSequence } from './filter-helpers.js';

// ─── WSDL Sequence Table (source of truth: ?xsd=xsd7 ServiceLocationFilter) ──

const SERVICE_LOCATION_FILTER_SEQUENCE: FilterSequence = [
  ['fromCreatedDate', 'FromCreatedDate'],
  ['fromLastModifiedDate', 'FromLastModifiedDate'],
  ['serviceLocationId', 'ID'],
  ['practiceId', 'PracticeID'],
  ['practiceName', 'PracticeName'],
  ['toCreatedDate', 'ToCreatedDate'],
  ['toLastModifiedDate', 'ToLastModifiedDate'],
];

// ─── Request Body Builder (exported for tests) ──────────────────

export function buildGetServiceLocationsBody(args: Record<string, unknown>): string {
  return buildListGetBody(SERVICE_LOCATION_FILTER_SEQUENCE, args);
}

// ─── Tool Definitions ───────────────────────────────────────────

export const serviceLocationTools = [
  {
    name: 'tebra_get_service_locations',
    description:
      'Get all service locations (offices/facilities). Required for creating appointments and encounters. Optionally filter by practice or location ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        practiceName: {
          type: 'string',
          description: 'Optional practice name filter',
        },
        practiceId: {
          type: 'string',
          description: 'Optional practice ID filter',
        },
        serviceLocationId: {
          type: 'string',
          description: 'Optional service location ID lookup',
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

  const bodyXml = buildGetServiceLocationsBody(args);
  const xml = await soapRequest(config, 'GetServiceLocations', bodyXml);
  const blocks = extractAllTags(xml, 'ServiceLocationData');

  const locations = blocks
    .map((block) => ({
      serviceLocationId: extractTag(block, 'ID'),
      name: extractTag(block, 'Name'),
      billingName: extractTag(block, 'BillingName'),
      address1: extractTag(block, 'AddressLine1'),
      address2: extractTag(block, 'AddressLine2'),
      city: extractTag(block, 'City'),
      state: extractTag(block, 'State'),
      zipCode: extractTag(block, 'ZipCode'),
      phone: extractTag(block, 'Phone'),
      fax: extractTag(block, 'FaxPhone'),
      npi: extractTag(block, 'NPI'),
      placeOfService: extractTag(block, 'PlaceOfService'),
      practiceName: extractTag(block, 'PracticeName'),
    }))
    // Drop the phantom placeholder block Tebra emits on empty result sets.
    .filter((location) => location.serviceLocationId !== '');

  if (locations.length === 0) {
    return {
      content: [{ type: 'text', text: 'No service locations found.' }],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(locations, null, 2) }],
  };
}
