/**
 * Tebra MCP tools: Encounter status update.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const encounterStatusTools = [
  {
    name: 'tebra_update_encounter_status',
    description:
      'Update the status of an encounter in Tebra. Use to move encounters through the workflow (Draft, Review, Approved, Rejected).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        encounterId: {
          type: 'string',
          description: 'Tebra encounter ID',
        },
        status: {
          type: 'string',
          description: 'New status: Draft, Review, Approved, or Rejected',
          enum: ['Draft', 'Review', 'Approved', 'Rejected'],
        },
        reviewNote: {
          type: 'string',
          description: 'Optional note explaining the status change',
        },
      },
      required: ['encounterId', 'status'],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleEncounterStatusTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (name !== 'tebra_update_encounter_status') {
    return { content: [{ type: 'text', text: `Unknown encounter status tool: ${name}` }] };
  }

  const encounterId = String(args.encounterId ?? '');
  const status = String(args.status ?? '');

  if (!encounterId || !status) {
    return {
      content: [{ type: 'text', text: 'encounterId and status are required.' }],
    };
  }

  const validStatuses = ['Draft', 'Review', 'Approved', 'Rejected'];
  if (!validStatuses.includes(status)) {
    return {
      content: [{ type: 'text', text: `Invalid status "${status}". Must be one of: ${validStatuses.join(', ')}` }],
    };
  }

  const reviewNote = args.reviewNote ? String(args.reviewNote) : undefined;

  const bodyXml = `
    <kar:request>
      <kar:EncounterID>${escapeXml(encounterId)}</kar:EncounterID>
      <kar:Status>${escapeXml(status)}</kar:Status>
      ${reviewNote ? `<kar:Notes>${escapeXml(reviewNote)}</kar:Notes>` : ''}
    </kar:request>`;

  const xml = await soapRequest(config, 'UpdateEncounterStatus', bodyXml);
  const updatedId = extractTag(xml, 'EncounterID') || extractTag(xml, 'ID') || encounterId;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        encounterId: updatedId,
        status,
        message: `Encounter status updated to ${status}.`,
      }, null, 2),
    }],
  };
}
