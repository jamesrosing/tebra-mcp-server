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
      'Get appointments from Tebra within a date range. Optionally filter by provider.',
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
          description: 'Optional Tebra provider ID to filter by',
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

  const providerId = args.providerId ? String(args.providerId) : undefined;

  const bodyXml = `
    <kar:request>
      <kar:Fields>
        <kar:StartDate>${escapeXml(startDate)}</kar:StartDate>
        <kar:EndDate>${escapeXml(endDate)}</kar:EndDate>
        ${providerId ? `<kar:ProviderID>${escapeXml(providerId)}</kar:ProviderID>` : ''}
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
