/**
 * Tebra MCP tools: Appointment reason retrieval.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, extractTag, extractAllTags } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const appointmentReasonTools = [
  {
    name: 'tebra_get_appointment_reasons',
    description:
      'Get all appointment reasons configured in the practice. Returns reason IDs, names, default durations, and color codes.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleAppointmentReasonTool(
  name: string,
  _args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (name !== 'tebra_get_appointment_reasons') {
    return { content: [{ type: 'text', text: `Unknown appointment reason tool: ${name}` }] };
  }

  const bodyXml = `
    <kar:request>
      <kar:Fields />
    </kar:request>`;

  const xml = await soapRequest(config, 'GetAppointmentReasons', bodyXml);
  const blocks = extractAllTags(xml, 'AppointmentReasonData');

  const reasons = blocks.map((block) => ({
    appointmentReasonId: extractTag(block, 'AppointmentReasonID') || extractTag(block, 'ID'),
    name: extractTag(block, 'Name'),
    defaultDurationMinutes: extractTag(block, 'DefaultDurationMinutes'),
    defaultColorCode: extractTag(block, 'DefaultColorCode'),
    practiceId: extractTag(block, 'PracticeID'),
  }));

  if (reasons.length === 0) {
    return {
      content: [{ type: 'text', text: 'No appointment reasons found.' }],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(reasons, null, 2) }],
  };
}
