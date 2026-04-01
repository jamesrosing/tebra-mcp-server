/**
 * Tebra MCP tools: Single appointment detail retrieval.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag } from '../soap-client.js';

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

  const bodyXml = `
    <kar:request>
      <kar:Fields>
        <kar:AppointmentID>${escapeXml(appointmentId)}</kar:AppointmentID>
      </kar:Fields>
    </kar:request>`;

  const xml = await soapRequest(config, 'GetAppointment', bodyXml);
  const apptBlock = extractTag(xml, 'Appointment') || extractTag(xml, 'AppointmentData');

  if (!apptBlock) {
    return {
      content: [{ type: 'text', text: `Appointment not found: ${appointmentId}` }],
    };
  }

  const detail = {
    appointmentId: extractTag(apptBlock, 'AppointmentID') || extractTag(apptBlock, 'ID'),
    patientId: extractTag(apptBlock, 'PatientID'),
    patientName: `${extractTag(apptBlock, 'PatientFirstName')} ${extractTag(apptBlock, 'PatientLastName')}`.trim(),
    providerId: extractTag(apptBlock, 'ProviderID'),
    providerName: extractTag(apptBlock, 'ProviderFullName'),
    serviceLocationId: extractTag(apptBlock, 'ServiceLocationID'),
    serviceLocationName: extractTag(apptBlock, 'ServiceLocationName'),
    startDate: extractTag(apptBlock, 'StartDate'),
    endDate: extractTag(apptBlock, 'EndDate'),
    duration: extractTag(apptBlock, 'Duration'),
    appointmentType: extractTag(apptBlock, 'AppointmentType'),
    appointmentReason: extractTag(apptBlock, 'AppointmentReason'),
    status: extractTag(apptBlock, 'Status') || extractTag(apptBlock, 'AppointmentStatus'),
    confirmationStatus: extractTag(apptBlock, 'ConfirmationStatus'),
    notes: extractTag(apptBlock, 'Notes'),
    recurrenceRule: extractTag(apptBlock, 'RecurrenceRule'),
    recurrenceId: extractTag(apptBlock, 'RecurrenceID'),
    groupId: extractTag(apptBlock, 'GroupID'),
    groupName: extractTag(apptBlock, 'GroupName'),
    resource1: extractTag(apptBlock, 'Resource1'),
    resource2: extractTag(apptBlock, 'Resource2'),
    resource3: extractTag(apptBlock, 'Resource3'),
    resource4: extractTag(apptBlock, 'Resource4'),
    resource5: extractTag(apptBlock, 'Resource5'),
    resource6: extractTag(apptBlock, 'Resource6'),
    resource7: extractTag(apptBlock, 'Resource7'),
    resource8: extractTag(apptBlock, 'Resource8'),
    resource9: extractTag(apptBlock, 'Resource9'),
    resource10: extractTag(apptBlock, 'Resource10'),
    createdDate: extractTag(apptBlock, 'CreatedDate'),
    lastModifiedDate: extractTag(apptBlock, 'LastModifiedDate'),
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }],
  };
}
