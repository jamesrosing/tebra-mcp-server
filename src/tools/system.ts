/**
 * Tebra MCP tools: System utilities — throttles, connection validation, patient case, appointment reason creation.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const systemTools = [
  {
    name: 'tebra_get_throttles',
    description:
      'Get current API rate limit (throttle) data for each endpoint. Useful for monitoring API usage.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'tebra_validate_connection',
    description:
      'Validate the Tebra API connection by retrieving the customer ID. Use as a health check.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'tebra_update_patient_case',
    description:
      'Update the primary patient case in Tebra. Used to set case name and payer scenario.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra patient ID',
        },
        caseName: {
          type: 'string',
          description: 'Optional case name',
        },
        payerScenario: {
          type: 'string',
          description: 'Optional payer scenario',
        },
      },
      required: ['patientId'],
    },
  },
  {
    name: 'tebra_create_appointment_reason',
    description:
      'Create a new appointment reason in Tebra with name, default duration, and optional color/category.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Appointment reason name',
        },
        duration: {
          type: 'number',
          description: 'Default duration in minutes',
        },
        color: {
          type: 'string',
          description: 'Optional color code (hex or named color)',
        },
        category: {
          type: 'string',
          description: 'Optional category',
        },
      },
      required: ['name', 'duration'],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleSystemTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'tebra_get_throttles': {
      const bodyXml = `
        <kar:request>
          <kar:Fields />
        </kar:request>`;

      const xml = await soapRequest(config, 'GetThrottles', bodyXml);
      const blocks = extractAllTags(xml, 'ThrottleData');

      const throttles = blocks.map((block) => ({
        endpoint: extractTag(block, 'Endpoint') || extractTag(block, 'Name'),
        limit: extractTag(block, 'Limit'),
        remaining: extractTag(block, 'Remaining'),
        resetTime: extractTag(block, 'ResetTime'),
      }));

      if (throttles.length === 0) {
        return {
          content: [{ type: 'text', text: 'No throttle data available.' }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(throttles, null, 2) }],
      };
    }

    case 'tebra_validate_connection': {
      const bodyXml = `
        <kar:request>
          <kar:Fields />
        </kar:request>`;

      const xml = await soapRequest(config, 'GetCustomerIdFromKey', bodyXml);
      const customerId = extractTag(xml, 'CustomerID') || extractTag(xml, 'ID');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            valid: !!customerId,
            customerId: customerId || null,
            message: customerId
              ? 'Connection validated successfully.'
              : 'Connection validation returned no customer ID.',
          }, null, 2),
        }],
      };
    }

    case 'tebra_update_patient_case': {
      const patientId = String(args.patientId ?? '');
      if (!patientId) {
        return { content: [{ type: 'text', text: 'patientId is required.' }] };
      }

      const caseName = args.caseName ? String(args.caseName) : undefined;
      const payerScenario = args.payerScenario ? String(args.payerScenario) : undefined;

      const bodyXml = `
        <kar:request>
          <kar:PatientID>${escapeXml(patientId)}</kar:PatientID>
          ${caseName ? `<kar:CaseName>${escapeXml(caseName)}</kar:CaseName>` : ''}
          ${payerScenario ? `<kar:PayerScenario>${escapeXml(payerScenario)}</kar:PayerScenario>` : ''}
        </kar:request>`;

      await soapRequest(config, 'UpdatePrimaryPatientCase', bodyXml);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            patientId,
            message: 'Patient case updated successfully.',
          }, null, 2),
        }],
      };
    }

    case 'tebra_create_appointment_reason': {
      const reasonName = String(args.name ?? '');
      const duration = args.duration != null ? Number(args.duration) : NaN;

      if (!reasonName || isNaN(duration)) {
        return {
          content: [{ type: 'text', text: 'name and duration are required.' }],
        };
      }

      const color = args.color ? String(args.color) : undefined;
      const category = args.category ? String(args.category) : undefined;

      const bodyXml = `
        <kar:request>
          <kar:AppointmentReason>
            <kar:Name>${escapeXml(reasonName)}</kar:Name>
            <kar:DefaultDurationMinutes>${duration}</kar:DefaultDurationMinutes>
            ${color ? `<kar:DefaultColorCode>${escapeXml(color)}</kar:DefaultColorCode>` : ''}
            ${category ? `<kar:Category>${escapeXml(category)}</kar:Category>` : ''}
          </kar:AppointmentReason>
        </kar:request>`;

      const xml = await soapRequest(config, 'CreateAppointmentReason', bodyXml);
      const reasonId = extractTag(xml, 'AppointmentReasonID') || extractTag(xml, 'ID');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            appointmentReasonId: reasonId,
            name: reasonName,
            duration,
            message: 'Appointment reason created successfully.',
          }, null, 2),
        }],
      };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown system tool: ${name}` }] };
  }
}
