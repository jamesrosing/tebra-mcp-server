/**
 * Tebra MCP tools: Appointment retrieval.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const appointmentTools = [
  {
    name: 'tebra_get_appointments',
    description:
      'Get appointments from Tebra within a date range. Filter by provider, patient, confirmation status, service location, reason, type, and more.',
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
        providerId: {
          type: 'string',
          description: 'Tebra provider ID to filter by',
        },
        confirmationStatus: {
          type: 'string',
          enum: ['Confirmed', 'CheckedIn', 'NoShow', 'CheckedOut', 'Rescheduled', 'Scheduled', 'Cancelled'],
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
        appointmentReason: {
          type: 'string',
          description: 'Filter by appointment reason',
        },
        appointmentType: {
          type: 'string',
          enum: ['U', 'P', 'O'],
          description: 'Filter by type: U=Unknown, P=Patient, O=Other',
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
    return { content: [{ type: 'text', text: 'startDate and endDate are required.' }] };
  }

  // Map of arg names to SOAP filter field names
  const optionalFilterMap: Array<[string, string]> = [
    ['providerId', 'ProviderID'],
    ['confirmationStatus', 'ConfirmationStatus'],
    ['patientFullName', 'PatientFullName'],
    ['patientId', 'PatientID'],
    ['serviceLocationName', 'ServiceLocationName'],
    ['appointmentReason', 'AppointmentReason'],
    ['appointmentType', 'Type'],
    ['fromCreatedDate', 'FromCreatedDate'],
    ['toCreatedDate', 'ToCreatedDate'],
    ['fromLastModifiedDate', 'FromLastModifiedDate'],
    ['toLastModifiedDate', 'ToLastModifiedDate'],
    ['casePayerScenario', 'PatientCasePayerScenario'],
  ];

  const optionalFields: string[] = [];
  for (const [argKey, soapField] of optionalFilterMap) {
    const val = args[argKey];
    if (val !== undefined && val !== null && val !== '') {
      optionalFields.push(`<kar:${soapField}>${escapeXml(String(val))}</kar:${soapField}>`);
    }
  }

  const bodyXml = `
    <kar:request>
      <kar:Fields>
        <kar:StartDate>${escapeXml(startDate)}</kar:StartDate>
        <kar:EndDate>${escapeXml(endDate)}</kar:EndDate>
        ${optionalFields.join('\n        ')}
      </kar:Fields>
    </kar:request>`;

  const xml = await soapRequest(config, 'GetAppointments', bodyXml);
  const blocks = extractAllTags(xml, 'AppointmentData');

  const appointments = blocks.map((block) => ({
    appointmentId: extractTag(block, 'AppointmentID') || extractTag(block, 'ID'),
    patientId: extractTag(block, 'PatientID'),
    patientName: `${extractTag(block, 'PatientFirstName')} ${extractTag(block, 'PatientLastName')}`.trim(),
    providerId: extractTag(block, 'ProviderID'),
    providerName: extractTag(block, 'ProviderFullName'),
    startDate: extractTag(block, 'StartDate'),
    endDate: extractTag(block, 'EndDate'),
    type: extractTag(block, 'AppointmentType'),
    status: extractTag(block, 'Status') || extractTag(block, 'AppointmentStatus'),
  }));

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
