/**
 * Tebra MCP tools: Single appointment detail retrieval.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const appointmentDetailTools = [
  {
    name: 'tebra_get_appointment_detail',
    description:
      'Get full detail for a single appointment by ID, including recurrence rules, group data, and all resource slots.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        appointmentId: {
          type: 'string',
          description: 'Tebra appointment ID',
        },
      },
      required: ['appointmentId'],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleAppointmentDetailTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (name !== 'tebra_get_appointment_detail') {
    return { content: [{ type: 'text', text: `Unknown appointment detail tool: ${name}` }] };
  }

  const appointmentId = String(args.appointmentId ?? '');
  if (!appointmentId) {
    return { content: [{ type: 'text', text: 'appointmentId is required.' }] };
  }

  // GetAppointment does NOT take the Fields/Filter shape the list endpoints
  // use. Per the live WSDL (KareoServices.svc?xsd=xsd0):
  //
  //   GetAppointmentReq  = RequestBase + <Appointment> (type AppointmentRead)
  //   AppointmentRead    = { AppointmentId: xs:long }        ← lowercase "d"
  //   GetAppointmentResp = ResponseBase + <Appointment> (type AppointmentCreate)
  //
  // The old Fields-based envelope faulted on every call with "'EndElement'
  // 'request' … is not expected. Expecting element 'Appointment'."
  const bodyXml = `
    <kar:request>
      <kar:Appointment>
        <kar:AppointmentId>${escapeXml(appointmentId)}</kar:AppointmentId>
      </kar:Appointment>
    </kar:request>`;

  const xml = await soapRequest(config, 'GetAppointment', bodyXml);

  const foundId = extractTag(xml, 'AppointmentId') || extractTag(xml, 'AppointmentID');
  if (!foundId) {
    return {
      content: [{ type: 'text', text: `Appointment not found: ${appointmentId}` }],
    };
  }

  // Response is the WSDL AppointmentCreate shape: patient nested under
  // <PatientSummary> (group attendees under <PatientSummaries>), ISO
  // StartTime/EndTime, AppointmentStatus, enum-letter AppointmentType.
  const summary = extractTag(xml, 'PatientSummary');
  const summaries = extractTag(xml, 'PatientSummaries');
  const groupPatients = summaries
    ? extractAllTags(summaries, 'GroupPatientSummary')
        .map((block) => ({
          patientId: extractTag(block, 'PatientId'),
          patientName: `${extractTag(block, 'FirstName')} ${extractTag(block, 'LastName')}`.trim(),
        }))
        .filter((p) => p.patientId || p.patientName)
    : [];

  const detail = {
    appointmentId: foundId,
    appointmentUuid: extractTag(xml, 'AppointmentUUID'),
    appointmentName: extractTag(xml, 'AppointmentName'),
    patientId: summary ? extractTag(summary, 'PatientId') : '',
    patientName: summary
      ? `${extractTag(summary, 'FirstName')} ${extractTag(summary, 'LastName')}`.trim()
      : '',
    patientDateOfBirth: summary ? extractTag(summary, 'DateOfBirth') : '',
    patientCaseId: extractTag(xml, 'PatientCaseId'),
    providerId: extractTag(xml, 'ProviderId'),
    resourceId: extractTag(xml, 'ResourceId'),
    resourceIds: extractTag(xml, 'ResourceIds'),
    serviceLocationId: extractTag(xml, 'ServiceLocationId'),
    startTime: extractTag(xml, 'StartTime'),
    endTime: extractTag(xml, 'EndTime'),
    appointmentType: extractTag(xml, 'AppointmentType'),
    appointmentMode: extractTag(xml, 'AppointmentMode'),
    appointmentReasonId: extractTag(xml, 'AppointmentReasonId'),
    status: extractTag(xml, 'AppointmentStatus'),
    notes: extractTag(xml, 'Notes'),
    isRecurring: extractTag(xml, 'IsRecurring'),
    recurrenceRule: extractTag(xml, 'RecurrenceRule'),
    occurrenceId: extractTag(xml, 'OccurrenceId'),
    isGroupAppointment: extractTag(xml, 'IsGroupAppointment'),
    maxAttendees: extractTag(xml, 'MaxAttendees'),
    attendeesCount: extractTag(xml, 'AttendeesCount'),
    groupPatients,
    insurancePolicyAuthorizationId: extractTag(xml, 'InsurancePolicyAuthorizationId'),
    wasCreatedOnline: extractTag(xml, 'WasCreatedOnline'),
    forRecare: extractTag(xml, 'ForRecare'),
    createdAt: extractTag(xml, 'CreatedAt'),
    updatedAt: extractTag(xml, 'UpdatedAt'),
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }],
  };
}
