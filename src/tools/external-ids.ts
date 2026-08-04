/**
 * Tebra MCP tools: External vendor and patient external ID management.
 *
 * WSDL shapes (xsd0):
 *   RegisterExternalVendorReq = { ExternalVendor: { ExternalVendorName } }
 *   UpdatePatientsExternalIDReq = { Updates: { UpdateBatch:
 *     PatientExternalIDSetting[] } } — note the camelCase member names
 *     inside the setting (externalID → externalVendorID → patientID →
 *     practiceID), which WCF matches case-sensitively.
 *   GetExternalVendors returns ExternalVendorData blocks
 *   ({ ExternalVendorID, ExternalVendorName }).
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';

// ─── Request Body Builders (exported for tests) ─────────────────

export function buildUpdateExternalIdBody(args: Record<string, unknown>): string {
  const patientId = String(args.patientId ?? '');
  const externalId = String(args.externalId ?? '');
  const externalVendorId = args.externalVendorId ? String(args.externalVendorId) : '';
  const practiceId = args.practiceId ? String(args.practiceId) : '';

  // Tebra's ExternalIDToPatientMap column holds 25 characters and TRUNCATES
  // silently on write (verified live 2026-08-04), which breaks every later
  // lookup by the full value. IDs are also UNIQUE per vendor. Fail closed.
  if (externalId.length > 25) {
    throw new Error(
      `tebra_update_patient_external_id: externalId '${externalId}' is ${externalId.length} chars — Tebra stores at most 25 and silently truncates, breaking lookups. Use a shorter ID.`
    );
  }

  // PatientExternalIDSetting sequence (camelCase): externalID →
  // externalVendorID → patientID → practiceID.
  return `
        <kar:request>
          <kar:Updates>
            <kar:UpdateBatch>
              <kar:PatientExternalIDSetting>
                <kar:externalID>${escapeXml(externalId)}</kar:externalID>
                ${externalVendorId ? `<kar:externalVendorID>${escapeXml(externalVendorId)}</kar:externalVendorID>` : ''}
                <kar:patientID>${escapeXml(patientId)}</kar:patientID>
                ${practiceId ? `<kar:practiceID>${escapeXml(practiceId)}</kar:practiceID>` : ''}
              </kar:PatientExternalIDSetting>
            </kar:UpdateBatch>
          </kar:Updates>
        </kar:request>`;
}

// ─── Tool Definitions ───────────────────────────────────────────

export const externalIdTools = [
  {
    name: 'tebra_update_patient_external_id',
    description:
      'Set or update a patient external ID in Tebra, linking the patient to an external system. Register the vendor first with tebra_register_external_vendor and pass its numeric ID as externalVendorId.',
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
        externalVendorId: {
          type: 'string',
          description: 'External vendor ID from tebra_get_external_vendors (recommended)',
        },
        practiceId: {
          type: 'string',
          description: 'Optional practice ID',
        },
      },
      required: ['patientId', 'externalId'],
    },
  },
  {
    name: 'tebra_register_external_vendor',
    description:
      'Register a new external vendor in Tebra for external ID mapping. Returns the vendor ID to use with tebra_update_patient_external_id.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        vendorName: {
          type: 'string',
          description: 'Vendor name to register',
        },
      },
      required: ['vendorName'],
    },
  },
  {
    name: 'tebra_get_external_vendors',
    description:
      'Get all registered external vendors in Tebra with their IDs.',
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
        throw new Error('patientId and externalId are required.');
      }

      const bodyXml = buildUpdateExternalIdBody(args);
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
        throw new Error('vendorName is required.');
      }

      // RegisterExternalVendorReq = { ExternalVendor: { ExternalVendorName } }.
      const bodyXml = `
        <kar:request>
          <kar:ExternalVendor>
            <kar:ExternalVendorName>${escapeXml(vendorName)}</kar:ExternalVendorName>
          </kar:ExternalVendor>
        </kar:request>`;

      const xml = await soapRequest(config, 'RegisterExternalVendor', bodyXml);
      const vendorId = extractTag(xml, 'ExternalVendorID');

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
      // GetExternalVendorsReq has no members beyond the request header.
      const bodyXml = `
        <kar:request>
        </kar:request>`;

      const xml = await soapRequest(config, 'GetExternalVendors', bodyXml);
      const blocks = extractAllTags(xml, 'ExternalVendorData');

      const vendors = blocks
        .map((block) => ({
          vendorId: extractTag(block, 'ExternalVendorID'),
          vendorName: extractTag(block, 'ExternalVendorName'),
        }))
        .filter((vendor) => vendor.vendorId !== '');

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
