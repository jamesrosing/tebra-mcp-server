/**
 * Tebra MCP tools: External vendor and patient external ID management.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const externalIdTools = [
  {
    name: 'tebra_update_patient_external_id',
    description:
      'Set or update a patient external ID in Tebra, linking the patient to an external system.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra patient ID',
        },
        externalId: {
          type: 'string',
          description: 'External system ID to assign',
        },
        vendorName: {
          type: 'string',
          description: 'Optional external vendor name',
        },
      },
      required: ['patientId', 'externalId'],
    },
  },
  {
    name: 'tebra_register_external_vendor',
    description:
      'Register a new external vendor in Tebra for external ID mapping.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        vendorName: {
          type: 'string',
          description: 'Vendor name to register',
        },
        vendorDescription: {
          type: 'string',
          description: 'Optional vendor description',
        },
      },
      required: ['vendorName'],
    },
  },
  {
    name: 'tebra_get_external_vendors',
    description:
      'Get all registered external vendors in Tebra.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleExternalIdTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'tebra_update_patient_external_id': {
      const patientId = String(args.patientId ?? '');
      const externalId = String(args.externalId ?? '');

      if (!patientId || !externalId) {
        return {
          content: [{ type: 'text', text: 'patientId and externalId are required.' }],
        };
      }

      const vendorName = args.vendorName ? String(args.vendorName) : undefined;

      const bodyXml = `
        <kar:request>
          <kar:PatientID>${escapeXml(patientId)}</kar:PatientID>
          <kar:ExternalID>${escapeXml(externalId)}</kar:ExternalID>
          ${vendorName ? `<kar:VendorName>${escapeXml(vendorName)}</kar:VendorName>` : ''}
        </kar:request>`;

      await soapRequest(config, 'UpdatePatientsExternalID', bodyXml);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            patientId,
            externalId,
            message: 'Patient external ID updated successfully.',
          }, null, 2),
        }],
      };
    }

    case 'tebra_register_external_vendor': {
      const vendorName = String(args.vendorName ?? '');
      if (!vendorName) {
        return { content: [{ type: 'text', text: 'vendorName is required.' }] };
      }

      const vendorDescription = args.vendorDescription ? String(args.vendorDescription) : undefined;

      const bodyXml = `
        <kar:request>
          <kar:VendorName>${escapeXml(vendorName)}</kar:VendorName>
          ${vendorDescription ? `<kar:VendorDescription>${escapeXml(vendorDescription)}</kar:VendorDescription>` : ''}
        </kar:request>`;

      const xml = await soapRequest(config, 'RegisterExternalVendor', bodyXml);
      const vendorId = extractTag(xml, 'VendorID') || extractTag(xml, 'ID');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            vendorId,
            vendorName,
            message: 'External vendor registered successfully.',
          }, null, 2),
        }],
      };
    }

    case 'tebra_get_external_vendors': {
      const bodyXml = `
        <kar:request>
          <kar:Fields />
        </kar:request>`;

      const xml = await soapRequest(config, 'GetExternalVendors', bodyXml);
      const blocks = extractAllTags(xml, 'VendorData');

      const vendors = blocks.map((block) => ({
        vendorId: extractTag(block, 'VendorID') || extractTag(block, 'ID'),
        vendorName: extractTag(block, 'VendorName') || extractTag(block, 'Name'),
        vendorDescription: extractTag(block, 'VendorDescription') || extractTag(block, 'Description'),
      }));

      if (vendors.length === 0) {
        return {
          content: [{ type: 'text', text: 'No external vendors registered.' }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(vendors, null, 2) }],
      };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown external ID tool: ${name}` }] };
  }
}
