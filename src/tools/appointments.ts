/**
 * Tebra MCP tools: Appointment retrieval.
 *
 * Criteria go in <kar:Filter> in WSDL AppointmentFilter sequence order —
 * see filter-helpers.ts and the wire-format quirks in CLAUDE.md. Note the
 * WSDL has no ProviderID filter member; the scheduler models providers as
 * resources, so filter by resourceName (provider full name) instead.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, extractTag, extractAllTags } from '../soap-client.js';
import {
  buildListGetBody,
  rejectUnsupportedFilterArg,
  type FilterSequence,
} from './filter-helpers.js';

// ─── WSDL Sequence Table (source of truth: ?xsd=xsd0 AppointmentFilter) ──

const APPOINTMENT_FILTER_SEQUENCE: FilterSequence = [
  ['appointmentReason', 'AppointmentReason'],
  ['confirmationStatus', 'ConfirmationStatus'],
  ['endDate', 'EndDate'],
  ['fromCreatedDate', 'FromCreatedDate'],
  ['fromLastModifiedDate', 'FromLastModifiedDate'],
  ['casePayerScenario', 'PatientCasePayerScenario'],
  ['patientFullName', 'PatientFullName'],
  ['patientId', 'PatientID'],
  ['practiceName', 'PracticeName'],
  ['resourceName', 'ResourceName'],
  ['serviceLocationName', 'ServiceLocationName'],
  ['startDate', 'StartDate'],
  ['timeZoneOffsetFromGMT', 'TimeZoneOffsetFromGMT'],
  ['toCreatedDate', 'ToCreatedDate'],
  ['toLastModifiedDate', 'ToLastModifiedDate'],
  ['appointmentType', 'Type'],
];

// ─── Request Body Builder (exported for tests) ──────────────────

export function buildGetAppointmentsBody(args: Record<string, unknown>): string {
  rejectUnsupportedFilterArg(
    args, 'providerId', 'tebra_get_appointments',
    "is not an AppointmentFilter member in the Tebra WSDL; filter by 'resourceName' " +
    '(the provider full name as it appears in the scheduler) instead.'
  );
  return buildListGetBody(APPOINTMENT_FILTER_SEQUENCE, args);
}

// ─── Tool Definitions ───────────────────────────────────────────

export const appointmentTools = [
  {
    name: 'tebra_get_appointments',
    description:
      'Get appointments from Tebra within a date range. Filter by resource (provider name), patient, confirmation status, service location, reason, type, and more. To filter by provider, use resourceName with the provider full name (the WSDL has no provider ID filter).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        startDate: {
          type: 'string',
          description: 'Start date (ISO 8601, e.g. 2026-03-25)',
        },
        endDate: {
          type: 'string',
          description: 'End date (ISO 8601, e.g. 2026-03-31)',
        },
        resourceName: {
          type: 'string',
          description: 'Scheduler resource name to filter by — for provider filtering, pass the provider full name',
        },
        confirmationStatus: {
          type: 'string',
          enum: ['Scheduled', 'ReminderSent', 'Confirmed', 'CheckedIn', 'Roomed', 'ReadyToBeSeen', 'CheckedOut', 'NeedsReschedule', 'NoShow', 'Cancelled', 'Rescheduled', 'Tentative'],
          description: 'Filter by confirmation status',
        },
        patientFullName: {
          type: 'string',
          description: 'Filter by patient full name',
        },
        patientId: {
          type: 'string',
          description: 'Filter by Tebra patient ID',
        },
        serviceLocationName: {
          type: 'string',
          description: 'Filter by service location name',
        },
        practiceName: {
          type: 'string',
          description: 'Filter by practice name',
        },
        appointmentReason: {
          type: 'string',
          description: 'Filter by appointment reason',
        },
        appointmentType: {
          type: 'string',
          enum: ['U', 'P', 'O'],
          description: 'Filter by type: U=Unknown, P=Patient, O=Other',
        },
        timeZoneOffsetFromGMT: {
          type: 'string',
          description: 'Time zone offset from GMT for returned times (e.g. -8)',
        },
        fromCreatedDate: {
          type: 'string',
          description: 'Created date range start (YYYY-MM-DD)',
        },
        toCreatedDate: {
          type: 'string',
          description: 'Created date range end (YYYY-MM-DD)',
        },
        fromLastModifiedDate: {
          type: 'string',
          description: 'Modified date range start (YYYY-MM-DD)',
        },
        toLastModifiedDate: {
          type: 'string',
          description: 'Modified date range end (YYYY-MM-DD)',
        },
        casePayerScenario: {
          type: 'string',
          description: 'Patient case payer scenario filter',
        },
      },
      required: ['startDate', 'endDate'],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleAppointmentTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (name !== 'tebra_get_appointments') {
    return { content: [{ type: 'text', text: `Unknown appointment tool: ${name}` }] };
  }

  const startDate = String(args.startDate ?? '');
  const endDate = String(args.endDate ?? '');

  if (!startDate || !endDate) {
    throw new Error('startDate and endDate are required.');
  }

  const bodyXml = buildGetAppointmentsBody(args);
  const xml = await soapRequest(config, 'GetAppointments', bodyXml);
  const blocks = extractAllTags(xml, 'AppointmentData');

  const appointments = blocks
    .map((block) => ({
      appointmentId: extractTag(block, 'ID'),
      patientId: extractTag(block, 'PatientID'),
      patientName: extractTag(block, 'PatientFullName'),
      resourceName: extractTag(block, 'ResourceName1'),
      startDate: extractTag(block, 'StartDate'),
      endDate: extractTag(block, 'EndDate'),
      duration: extractTag(block, 'AppointmentDuration'),
      type: extractTag(block, 'Type'),
      confirmationStatus: extractTag(block, 'ConfirmationStatus'),
      serviceLocationName: extractTag(block, 'ServiceLocationName'),
      appointmentReason: extractTag(block, 'AppointmentReason1'),
      practiceName: extractTag(block, 'PracticeName'),
      authorizationNumber: extractTag(block, 'AuthorizationNumber'),
      notes: extractTag(block, 'Notes'),
    }))
    // Drop the phantom placeholder block Tebra emits on empty result sets.
    .filter((appt) => appt.appointmentId !== '');

  if (appointments.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No appointments found between ${startDate} and ${endDate}.`,
        },
      ],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(appointments, null, 2) }],
  };
}
