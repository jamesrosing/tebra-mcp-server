/**
 * Tebra MCP tools: Appointment create, update, delete, and status update.
 *
 * These operations use the flat WSDL shapes (xsd0) — NOT the Fields/Filter
 * list shape and NOT nested Patient/Provider identifier groups:
 *   CreateAppointmentReq = { Appointment: AppointmentCreate }
 *   UpdateAppointmentReq = { Appointment: AppointmentUpdate }
 *   DeleteAppointmentReq = { Appointment: AppointmentDelete { AppointmentId } }
 *   UpdateAppointmentStatusReq = { Appointment: AppointmentStatusUpdate }
 *
 * AppointmentCreate/Update are flat: ProviderId, ServiceLocationId,
 * StartTime/EndTime (dateTime), AppointmentReasonId, and the patient rides
 * in a PatientSummary group. Members must be emitted in WSDL sequence
 * order — WCF silently drops out-of-order members. Note the lowercase 'd'
 * in AppointmentId/PatientId/ProviderId here (unlike the list endpoints).
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag } from '../soap-client.js';
import { resolveDefaultPracticeId } from './practices.js';

const APPOINTMENT_STATUSES = [
  'Unknown', 'Scheduled', 'ReminderSent', 'Confirmed', 'CheckedIn', 'Roomed',
  'CheckedOut', 'NeedsReschedule', 'ReadyToBeSeen', 'NoShow', 'Cancelled',
  'Rescheduled', 'Tentative',
];

/** Add minutes to a wall-clock ISO timestamp (no timezone conversion). */
function addMinutesIso(startIso: string, minutes: number): string {
  const d = new Date(startIso);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid startDate '${startIso}' — expected ISO 8601 (e.g. 2026-04-01T09:00:00).`);
  }
  d.setMinutes(d.getMinutes() + minutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function resolveEndTime(args: Record<string, unknown>, startDate: string): string {
  if (args.endDate) return String(args.endDate);
  const duration = args.duration != null ? Number(args.duration) : NaN;
  if (!isNaN(duration) && duration > 0) return addMinutesIso(startDate, duration);
  throw new Error('endDate or duration (minutes) is required to compute the appointment end time.');
}

// ─── Request Body Builders (exported for tests) ─────────────────

export function buildCreateAppointmentBody(args: Record<string, unknown>): string {
  const patientId = String(args.patientId ?? '');
  const providerId = String(args.providerId ?? '');
  const serviceLocationId = String(args.serviceLocationId ?? '');
  const startDate = String(args.startDate ?? '');
  const endTime = resolveEndTime(args, startDate);

  const appointmentReasonId = args.appointmentReasonId ? String(args.appointmentReasonId) : '';
  const practiceId = args.practiceId ? String(args.practiceId) : '';
  const notes = args.notes ? String(args.notes) : '';
  const appointmentMode = args.appointmentMode ? String(args.appointmentMode) : '';
  const appointmentStatus = args.appointmentStatus ? String(args.appointmentStatus) : 'Scheduled';
  const appointmentName = args.appointmentName ? String(args.appointmentName) : '';
  const authorizationId = args.insurancePolicyAuthorizationId ? String(args.insurancePolicyAuthorizationId) : '';

  // PracticeId is a REQUIRED AppointmentCreate member (minOccurs=1). The
  // handler auto-resolves it before calling this builder.
  if (!practiceId) {
    throw new Error('tebra_create_appointment: practiceId is required (the WSDL PracticeId member is mandatory).');
  }

  // AppointmentCreate WSDL sequence order (members we emit).
  return `
        <kar:request>
          <kar:Appointment>
            ${appointmentMode ? `<kar:AppointmentMode>${escapeXml(appointmentMode)}</kar:AppointmentMode>` : ''}
            ${appointmentName ? `<kar:AppointmentName>${escapeXml(appointmentName)}</kar:AppointmentName>` : ''}
            ${appointmentReasonId ? `<kar:AppointmentReasonId>${escapeXml(appointmentReasonId)}</kar:AppointmentReasonId>` : ''}
            <kar:AppointmentStatus>${escapeXml(appointmentStatus)}</kar:AppointmentStatus>
            <kar:AppointmentType>P</kar:AppointmentType>
            <kar:EndTime>${escapeXml(endTime)}</kar:EndTime>
            ${authorizationId ? `<kar:InsurancePolicyAuthorizationId>${escapeXml(authorizationId)}</kar:InsurancePolicyAuthorizationId>` : ''}
            <kar:IsGroupAppointment>false</kar:IsGroupAppointment>
            <kar:IsRecurring>false</kar:IsRecurring>
            ${notes ? `<kar:Notes>${escapeXml(notes)}</kar:Notes>` : ''}
            <kar:PatientSummary>
              <kar:PatientId>${escapeXml(patientId)}</kar:PatientId>
              <kar:PracticeId>${escapeXml(practiceId)}</kar:PracticeId>
            </kar:PatientSummary>
            <kar:PracticeId>${escapeXml(practiceId)}</kar:PracticeId>
            <kar:ProviderId>${escapeXml(providerId)}</kar:ProviderId>
            <kar:ServiceLocationId>${escapeXml(serviceLocationId)}</kar:ServiceLocationId>
            <kar:StartTime>${escapeXml(startDate)}</kar:StartTime>
          </kar:Appointment>
        </kar:request>`;
}

export function buildUpdateAppointmentBody(args: Record<string, unknown>): string {
  const appointmentId = String(args.appointmentId ?? '');
  const startDate = args.startDate ? String(args.startDate) : '';
  const providerId = args.providerId ? String(args.providerId) : '';
  const patientId = args.patientId ? String(args.patientId) : '';
  const serviceLocationId = args.serviceLocationId ? String(args.serviceLocationId) : '';
  const appointmentReasonId = args.appointmentReasonId ? String(args.appointmentReasonId) : '';
  const notes = args.notes ? String(args.notes) : '';
  const appointmentMode = args.appointmentMode ? String(args.appointmentMode) : '';
  // confirmationStatus is the backward-compatible alias for appointmentStatus.
  const appointmentStatus = args.appointmentStatus
    ? String(args.appointmentStatus)
    : args.confirmationStatus ? String(args.confirmationStatus) : '';

  // AppointmentUpdate marks AppointmentId, PatientId, and ServiceLocationId
  // as REQUIRED (minOccurs=1). The handler hydrates missing ones from
  // GetAppointment before calling this builder.
  if (!patientId || !serviceLocationId) {
    throw new Error('tebra_update_appointment: patientId and serviceLocationId are required by the WSDL (auto-hydrated by the handler from GetAppointment).');
  }

  let endTime = '';
  if (startDate) {
    endTime = resolveEndTime(args, startDate);
  } else if (args.endDate) {
    endTime = String(args.endDate);
  }

  // AppointmentUpdate WSDL sequence order (members we emit).
  return `
        <kar:request>
          <kar:Appointment>
            <kar:AppointmentId>${escapeXml(appointmentId)}</kar:AppointmentId>
            ${appointmentMode ? `<kar:AppointmentMode>${escapeXml(appointmentMode)}</kar:AppointmentMode>` : ''}
            ${appointmentReasonId ? `<kar:AppointmentReasonId>${escapeXml(appointmentReasonId)}</kar:AppointmentReasonId>` : ''}
            ${appointmentStatus ? `<kar:AppointmentStatus>${escapeXml(appointmentStatus)}</kar:AppointmentStatus>` : ''}
            ${endTime ? `<kar:EndTime>${escapeXml(endTime)}</kar:EndTime>` : ''}
            ${notes ? `<kar:Notes>${escapeXml(notes)}</kar:Notes>` : ''}
            <kar:PatientId>${escapeXml(patientId)}</kar:PatientId>
            ${providerId ? `<kar:ProviderId>${escapeXml(providerId)}</kar:ProviderId>` : ''}
            <kar:ServiceLocationId>${escapeXml(serviceLocationId)}</kar:ServiceLocationId>
            ${startDate ? `<kar:StartTime>${escapeXml(startDate)}</kar:StartTime>` : ''}
          </kar:Appointment>
        </kar:request>`;
}

// ─── Tool Definitions ───────────────────────────────────────────

export const appointmentCrudTools = [
  {
    name: 'tebra_create_appointment',
    description:
      'Create a new patient appointment in Tebra. Requires patient, provider, service location, start time, and either endDate or duration (minutes). Optionally set reason, mode (InOffice/Telehealth), status, and notes.',
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
        startDate: {
          type: 'string',
          description: 'Appointment start date/time (ISO 8601, e.g. 2026-04-01T09:00:00)',
        },
        endDate: {
          type: 'string',
          description: 'Appointment end date/time (ISO 8601); alternative to duration',
        },
        duration: {
          type: 'number',
          description: 'Duration in minutes (used to compute end time when endDate is omitted)',
        },
        appointmentReasonId: {
          type: 'string',
          description: 'Optional Tebra appointment reason ID',
        },
        practiceId: {
          type: 'string',
          description: "Practice ID (required by Tebra; auto-resolved to the account's first practice if omitted)",
        },
        appointmentMode: {
          type: 'string',
          enum: ['InOffice', 'Telehealth'],
          description: 'Optional appointment mode',
        },
        appointmentStatus: {
          type: 'string',
          enum: APPOINTMENT_STATUSES,
          description: "Optional initial status (default 'Scheduled')",
        },
        appointmentName: {
          type: 'string',
          description: 'Optional appointment display name',
        },
        insurancePolicyAuthorizationId: {
          type: 'string',
          description: 'Optional insurance authorization ID to link',
        },
        notes: {
          type: 'string',
          description: 'Optional appointment notes',
        },
      },
      required: ['patientId', 'providerId', 'serviceLocationId', 'startDate'],
    },
  },
  {
    name: 'tebra_update_appointment',
    description:
      'Update an existing appointment in Tebra. Only provided fields will be changed. When changing startDate, also provide endDate or duration. To only change the status, prefer tebra_update_appointment_status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        appointmentId: {
          type: 'string',
          description: 'Tebra appointment ID to update',
        },
        startDate: {
          type: 'string',
          description: 'Optional new start date/time (ISO 8601); provide endDate or duration with it',
        },
        endDate: {
          type: 'string',
          description: 'Optional new end date/time (ISO 8601)',
        },
        duration: {
          type: 'number',
          description: 'Optional new duration in minutes (computes end time from startDate)',
        },
        providerId: {
          type: 'string',
          description: 'Optional new provider ID',
        },
        patientId: {
          type: 'string',
          description: 'Patient ID (required by Tebra; auto-hydrated from the existing appointment if omitted)',
        },
        serviceLocationId: {
          type: 'string',
          description: 'Service location ID (required by Tebra; auto-hydrated from the existing appointment if omitted)',
        },
        appointmentReasonId: {
          type: 'string',
          description: 'Optional new appointment reason ID',
        },
        appointmentStatus: {
          type: 'string',
          enum: APPOINTMENT_STATUSES,
          description: 'Optional new status',
        },
        confirmationStatus: {
          type: 'string',
          description: 'Deprecated alias for appointmentStatus',
        },
        appointmentMode: {
          type: 'string',
          enum: ['InOffice', 'Telehealth'],
          description: 'Optional new mode',
        },
        notes: {
          type: 'string',
          description: 'Optional updated notes',
        },
      },
      required: ['appointmentId'],
    },
  },
  {
    name: 'tebra_update_appointment_status',
    description:
      'Update only the status of an appointment (e.g. Confirmed, CheckedIn, NoShow, Cancelled). Lighter than tebra_update_appointment — use for check-in/check-out workflows.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        appointmentId: {
          type: 'string',
          description: 'Tebra appointment ID',
        },
        appointmentStatus: {
          type: 'string',
          enum: APPOINTMENT_STATUSES,
          description: 'New appointment status',
        },
      },
      required: ['appointmentId', 'appointmentStatus'],
    },
  },
  {
    name: 'tebra_delete_appointment',
    description:
      'Delete an appointment from Tebra by appointment ID. This is irreversible — to keep history, prefer tebra_update_appointment_status with Cancelled.',
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
      const required = ['patientId', 'providerId', 'serviceLocationId', 'startDate'];
      const missing = required.filter((key) => !args[key]);
      if (missing.length > 0) {
        throw new Error(`Missing required fields: ${missing.join(', ')}. Also provide endDate or duration.`);
      }

      // PracticeId is a required AppointmentCreate member — resolve when omitted.
      const effectiveArgs = args.practiceId
        ? args
        : { ...args, practiceId: await resolveDefaultPracticeId(config) };

      const bodyXml = buildCreateAppointmentBody(effectiveArgs);
      const xml = await soapRequest(config, 'CreateAppointment', bodyXml);
      const appointmentId = extractTag(xml, 'AppointmentId') || extractTag(xml, 'AppointmentID');

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
        throw new Error('appointmentId is required.');
      }

      // PatientId and ServiceLocationId are required AppointmentUpdate
      // members — hydrate missing ones from the current appointment.
      let effectiveArgs = args;
      if (!args.patientId || !args.serviceLocationId) {
        const detailBody = `
        <kar:request>
          <kar:Appointment>
            <kar:AppointmentId>${escapeXml(appointmentId)}</kar:AppointmentId>
          </kar:Appointment>
        </kar:request>`;
        const detailXml = await soapRequest(config, 'GetAppointment', detailBody);
        const summary = extractTag(detailXml, 'PatientSummary');
        effectiveArgs = {
          ...args,
          patientId: args.patientId ?? (summary ? extractTag(summary, 'PatientId') : ''),
          serviceLocationId: args.serviceLocationId ?? extractTag(detailXml, 'ServiceLocationId'),
        };
      }

      const bodyXml = buildUpdateAppointmentBody(effectiveArgs);
      const xml = await soapRequest(config, 'UpdateAppointment', bodyXml);
      const updatedId = extractTag(xml, 'AppointmentId') || appointmentId;

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

    case 'tebra_update_appointment_status': {
      const appointmentId = String(args.appointmentId ?? '');
      const appointmentStatus = String(args.appointmentStatus ?? '');

      if (!appointmentId || !appointmentStatus) {
        throw new Error('appointmentId and appointmentStatus are required.');
      }
      if (!APPOINTMENT_STATUSES.includes(appointmentStatus)) {
        throw new Error(`Invalid appointmentStatus "${appointmentStatus}". Must be one of: ${APPOINTMENT_STATUSES.join(', ')}`);
      }

      // AppointmentStatusUpdate WSDL sequence: AppointmentId → AppointmentStatus.
      const bodyXml = `
        <kar:request>
          <kar:Appointment>
            <kar:AppointmentId>${escapeXml(appointmentId)}</kar:AppointmentId>
            <kar:AppointmentStatus>${escapeXml(appointmentStatus)}</kar:AppointmentStatus>
          </kar:Appointment>
        </kar:request>`;

      await soapRequest(config, 'UpdateAppointmentStatus', bodyXml);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            appointmentId,
            appointmentStatus,
            message: `Appointment status updated to ${appointmentStatus}.`,
          }, null, 2),
        }],
      };
    }

    case 'tebra_delete_appointment': {
      const appointmentId = String(args.appointmentId ?? '');
      if (!appointmentId) {
        throw new Error('appointmentId is required.');
      }

      // DeleteAppointmentReq = { Appointment: AppointmentDelete { AppointmentId } }.
      const bodyXml = `
        <kar:request>
          <kar:Appointment>
            <kar:AppointmentId>${escapeXml(appointmentId)}</kar:AppointmentId>
          </kar:Appointment>
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
