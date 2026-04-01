/**
 * Tebra MCP tools: Appointment create, update, delete.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const appointmentCrudTools = [
  {
    name: 'tebra_create_appointment',
    description:
      'Create a new appointment in Tebra. Requires patient, provider, service location, appointment reason, and start date.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra patient ID',
        },
        providerId: {
          type: 'string',
          description: 'Tebra provider ID',
        },
        serviceLocationId: {
          type: 'string',
          description: 'Tebra service location ID',
        },
        appointmentReasonId: {
          type: 'string',
          description: 'Tebra appointment reason ID',
        },
        startDate: {
          type: 'string',
          description: 'Appointment start date/time (ISO 8601, e.g. 2026-04-01T09:00:00)',
        },
        duration: {
          type: 'number',
          description: 'Optional duration in minutes (defaults to appointment reason default)',
        },
        notes: {
          type: 'string',
          description: 'Optional appointment notes',
        },
        confirmationStatus: {
          type: 'string',
          description: 'Optional confirmation status (e.g. Confirmed, Unconfirmed)',
        },
      },
      required: ['patientId', 'providerId', 'serviceLocationId', 'appointmentReasonId', 'startDate'],
    },
  },
  {
    name: 'tebra_update_appointment',
    description:
      'Update an existing appointment in Tebra. Only provided fields will be changed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        appointmentId: {
          type: 'string',
          description: 'Tebra appointment ID to update',
        },
        startDate: {
          type: 'string',
          description: 'Optional new start date/time (ISO 8601)',
        },
        duration: {
          type: 'number',
          description: 'Optional new duration in minutes',
        },
        providerId: {
          type: 'string',
          description: 'Optional new provider ID',
        },
        confirmationStatus: {
          type: 'string',
          description: 'Optional new confirmation status',
        },
        notes: {
          type: 'string',
          description: 'Optional updated notes',
        },
        cancellationReason: {
          type: 'string',
          description: 'Optional cancellation reason (for cancelled appointments)',
        },
      },
      required: ['appointmentId'],
    },
  },
  {
    name: 'tebra_delete_appointment',
    description:
      'Delete an appointment from Tebra by appointment ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        appointmentId: {
          type: 'string',
          description: 'Tebra appointment ID to delete',
        },
      },
      required: ['appointmentId'],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleAppointmentCrudTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'tebra_create_appointment': {
      const patientId = String(args.patientId ?? '');
      const providerId = String(args.providerId ?? '');
      const serviceLocationId = String(args.serviceLocationId ?? '');
      const appointmentReasonId = String(args.appointmentReasonId ?? '');
      const startDate = String(args.startDate ?? '');

      if (!patientId || !providerId || !serviceLocationId || !appointmentReasonId || !startDate) {
        return {
          content: [{
            type: 'text',
            text: 'patientId, providerId, serviceLocationId, appointmentReasonId, and startDate are all required.',
          }],
        };
      }

      const duration = args.duration != null ? Number(args.duration) : undefined;
      const notes = args.notes ? String(args.notes) : undefined;
      const confirmationStatus = args.confirmationStatus ? String(args.confirmationStatus) : undefined;

      const bodyXml = `
        <kar:request>
          <kar:Appointment>
            <kar:Patient>
              <kar:PatientID>${escapeXml(patientId)}</kar:PatientID>
            </kar:Patient>
            <kar:Provider>
              <kar:ProviderID>${escapeXml(providerId)}</kar:ProviderID>
            </kar:Provider>
            <kar:ServiceLocation>
              <kar:ServiceLocationID>${escapeXml(serviceLocationId)}</kar:ServiceLocationID>
            </kar:ServiceLocation>
            <kar:AppointmentReason>
              <kar:AppointmentReasonID>${escapeXml(appointmentReasonId)}</kar:AppointmentReasonID>
            </kar:AppointmentReason>
            <kar:StartDate>${escapeXml(startDate)}</kar:StartDate>
            ${duration != null ? `<kar:Duration>${duration}</kar:Duration>` : ''}
            ${notes ? `<kar:Notes>${escapeXml(notes)}</kar:Notes>` : ''}
            ${confirmationStatus ? `<kar:ConfirmationStatus>${escapeXml(confirmationStatus)}</kar:ConfirmationStatus>` : ''}
          </kar:Appointment>
        </kar:request>`;

      const xml = await soapRequest(config, 'CreateAppointment', bodyXml);
      const appointmentId = extractTag(xml, 'AppointmentID') || extractTag(xml, 'ID');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            appointmentId,
            message: 'Appointment created successfully.',
          }, null, 2),
        }],
      };
    }

    case 'tebra_update_appointment': {
      const appointmentId = String(args.appointmentId ?? '');
      if (!appointmentId) {
        return { content: [{ type: 'text', text: 'appointmentId is required.' }] };
      }

      const startDate = args.startDate ? String(args.startDate) : undefined;
      const duration = args.duration != null ? Number(args.duration) : undefined;
      const providerId = args.providerId ? String(args.providerId) : undefined;
      const confirmationStatus = args.confirmationStatus ? String(args.confirmationStatus) : undefined;
      const notes = args.notes ? String(args.notes) : undefined;
      const cancellationReason = args.cancellationReason ? String(args.cancellationReason) : undefined;

      const bodyXml = `
        <kar:request>
          <kar:Appointment>
            <kar:AppointmentID>${escapeXml(appointmentId)}</kar:AppointmentID>
            ${startDate ? `<kar:StartDate>${escapeXml(startDate)}</kar:StartDate>` : ''}
            ${duration != null ? `<kar:Duration>${duration}</kar:Duration>` : ''}
            ${providerId ? `<kar:Provider><kar:ProviderID>${escapeXml(providerId)}</kar:ProviderID></kar:Provider>` : ''}
            ${confirmationStatus ? `<kar:ConfirmationStatus>${escapeXml(confirmationStatus)}</kar:ConfirmationStatus>` : ''}
            ${notes ? `<kar:Notes>${escapeXml(notes)}</kar:Notes>` : ''}
            ${cancellationReason ? `<kar:CancellationReason>${escapeXml(cancellationReason)}</kar:CancellationReason>` : ''}
          </kar:Appointment>
        </kar:request>`;

      const xml = await soapRequest(config, 'UpdateAppointment', bodyXml);
      const updatedId = extractTag(xml, 'AppointmentID') || extractTag(xml, 'ID') || appointmentId;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            appointmentId: updatedId,
            message: 'Appointment updated successfully.',
          }, null, 2),
        }],
      };
    }

    case 'tebra_delete_appointment': {
      const appointmentId = String(args.appointmentId ?? '');
      if (!appointmentId) {
        return { content: [{ type: 'text', text: 'appointmentId is required.' }] };
      }

      const bodyXml = `
        <kar:request>
          <kar:AppointmentID>${escapeXml(appointmentId)}</kar:AppointmentID>
        </kar:request>`;

      await soapRequest(config, 'DeleteAppointment', bodyXml);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            appointmentId,
            message: 'Appointment deleted successfully.',
          }, null, 2),
        }],
      };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown appointment CRUD tool: ${name}` }] };
  }
}
