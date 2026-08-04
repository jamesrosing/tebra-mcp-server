/**
 * Tebra MCP tools: System utilities — throttles, connection validation,
 * primary patient case, appointment reason creation.
 *
 * WSDL notes (xsd0):
 *   GetThrottlesReq has no members; the response is ThrottleDetail blocks
 *     ({ Endpoint, ThrottleTimeMs }).
 *   GetCustomerIdFromKeyRequest does NOT extend RequestBase — it takes
 *     CustomerKey → Password → User directly in the request body.
 *   UpdatePrimaryPatientCaseRequest = { PatientCaseId } — it promotes an
 *     existing case to primary; it cannot rename a case or set a payer
 *     scenario.
 *   CreateAppointmentReasonReq wraps AppointmentReasonCreate (sequence:
 *     DefaultColorCode(int) → DefaultDurationMinutes → Name → PracticeId).
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const systemTools = [
  {
    name: 'tebra_get_throttles',
    description:
      'Get the per-endpoint API throttle intervals (milliseconds between calls) that Tebra enforces for this account. Useful for monitoring API usage limits.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'tebra_validate_connection',
    description:
      'Validate the Tebra API credentials by retrieving the customer ID and authorization flag. Use as a health check.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'tebra_set_primary_patient_case',
    description:
      'Promote an existing patient case to be the primary case, by case ID. Find case IDs via tebra_get_patient (cases[].caseId). Note: this cannot rename a case or change its payer scenario.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientCaseId: {
          type: 'string',
          description: 'Tebra patient case ID to promote to primary',
        },
      },
      required: ['patientCaseId'],
    },
  },
  {
    name: 'tebra_create_appointment_reason',
    description:
      'Create a new appointment reason in Tebra with name and default duration. Color is a Tebra color code number (not hex).',
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
          type: 'number',
          description: 'Optional Tebra color code (integer)',
        },
        practiceId: {
          type: 'string',
          description: 'Optional practice ID',
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
      // GetThrottlesReq carries only the request header.
      const bodyXml = `
        <kar:request>
        </kar:request>`;

      const xml = await soapRequest(config, 'GetThrottles', bodyXml);
      const blocks = extractAllTags(xml, 'ThrottleDetail');

      const throttles = blocks
        .map((block) => ({
          endpoint: extractTag(block, 'Endpoint'),
          throttleTimeMs: extractTag(block, 'ThrottleTimeMs'),
        }))
        .filter((throttle) => throttle.endpoint !== '');

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
      // GetCustomerIdFromKeyRequest takes credentials directly (it does not
      // extend RequestBase): CustomerKey → Password → User.
      const bodyXml = `
        <kar:request>
          <kar:CustomerKey>${escapeXml(config.customerKey)}</kar:CustomerKey>
          <kar:Password>${escapeXml(config.password)}</kar:Password>
          <kar:User>${escapeXml(config.user)}</kar:User>
        </kar:request>`;

      const xml = await soapRequest(config, 'GetCustomerIdFromKey', bodyXml);
      const customerId = extractTag(xml, 'CustomerId');
      const isAuthorized = extractTag(xml, 'IsAuthorized');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            valid: !!customerId && isAuthorized.toLowerCase() !== 'false',
            customerId: customerId || null,
            isAuthorized: isAuthorized || null,
            message: customerId
              ? 'Connection validated successfully.'
              : 'Connection validation returned no customer ID — check credentials.',
          }, null, 2),
        }],
      };
    }

    case 'tebra_set_primary_patient_case':
    case 'tebra_update_patient_case': {
      const patientCaseId = String(args.patientCaseId ?? '');
      if (!patientCaseId) {
        throw new Error('patientCaseId is required. Find case IDs via tebra_get_patient (cases[].caseId). Note: UpdatePrimaryPatientCase only promotes a case to primary — it cannot set case name or payer scenario.');
      }

      const bodyXml = `
        <kar:request>
          <kar:PatientCaseId>${escapeXml(patientCaseId)}</kar:PatientCaseId>
        </kar:request>`;

      await soapRequest(config, 'UpdatePrimaryPatientCase', bodyXml);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            patientCaseId,
            message: 'Patient case promoted to primary.',
          }, null, 2),
        }],
      };
    }

    case 'tebra_create_appointment_reason': {
      const reasonName = String(args.name ?? '');
      const duration = args.duration != null ? Number(args.duration) : NaN;

      if (!reasonName || isNaN(duration)) {
        throw new Error('name and duration are required.');
      }

      const color = args.color != null ? Number(args.color) : NaN;
      const practiceId = args.practiceId ? String(args.practiceId) : '';

      // AppointmentReasonCreate WSDL sequence: DefaultColorCode →
      // DefaultDurationMinutes → Name → PracticeId.
      const bodyXml = `
        <kar:request>
          <kar:AppointmentReason>
            ${!isNaN(color) ? `<kar:DefaultColorCode>${color}</kar:DefaultColorCode>` : ''}
            <kar:DefaultDurationMinutes>${duration}</kar:DefaultDurationMinutes>
            <kar:Name>${escapeXml(reasonName)}</kar:Name>
            ${practiceId ? `<kar:PracticeId>${escapeXml(practiceId)}</kar:PracticeId>` : ''}
          </kar:AppointmentReason>
        </kar:request>`;

      const xml = await soapRequest(config, 'CreateAppointmentReason', bodyXml);
      const reasonId = extractTag(xml, 'AppointmentReasonId') || extractTag(xml, 'AppointmentReasonID');

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
