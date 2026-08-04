/**
 * Tebra MCP tools: Appointment reason retrieval.
 *
 * GetAppointmentReasonsReq has a single optional member (PracticeId) —
 * it does not use the Fields/Filter list shape.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const appointmentReasonTools = [
  {
    name: 'tebra_get_appointment_reasons',
    description:
      'Get all appointment reasons configured in the practice. Returns reason IDs, names, default durations, and color codes. Needed to create appointments with a reason.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        practiceId: {
          type: 'string',
          description: 'Optional practice ID filter',
        },
      },
      required: [],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleAppointmentReasonTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (name !== 'tebra_get_appointment_reasons') {
    return { content: [{ type: 'text', text: `Unknown appointment reason tool: ${name}` }] };
  }

  const practiceId = args.practiceId ? String(args.practiceId) : '';

  const bodyXml = `
    <kar:request>
      ${practiceId ? `<kar:PracticeId>${escapeXml(practiceId)}</kar:PracticeId>` : ''}
    </kar:request>`;

  const xml = await soapRequest(config, 'GetAppointmentReasons', bodyXml);
  const blocks = extractAllTags(xml, 'AppointmentReasonData');

  const reasons = blocks
    .map((block) => ({
      appointmentReasonId: extractTag(block, 'AppointmentReasonId'),
      name: extractTag(block, 'Name'),
      defaultDurationMinutes: extractTag(block, 'DefaultDurationMinutes'),
      defaultColorCode: extractTag(block, 'DefaultColorCode'),
      practiceId: extractTag(block, 'PracticeId'),
    }))
    .filter((reason) => reason.appointmentReasonId !== '');

  if (reasons.length === 0) {
    return {
      content: [{ type: 'text', text: 'No appointment reasons found.' }],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(reasons, null, 2) }],
  };
}
