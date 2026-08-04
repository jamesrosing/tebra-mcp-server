/**
 * Tebra MCP tools: Encounter status update.
 *
 * UpdateEncounterStatusReq wraps an <EncounterUpdateStatus> element
 * (WSDL sequence: EncounterID → EncounterStatus → Practice). The real
 * status enum is EncounterStatusCode: Draft, Submitted, Approved,
 * Rejected, Unpayable — there is no 'Review' status in the WSDL.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag } from '../soap-client.js';

const VALID_STATUSES = ['Draft', 'Submitted', 'Approved', 'Rejected', 'Unpayable'];

// ─── Request Body Builder (exported for tests) ──────────────────

export function buildUpdateEncounterStatusBody(args: Record<string, unknown>): string {
  const encounterId = String(args.encounterId ?? '');
  const status = String(args.status ?? '');
  const practiceId = args.practiceId ? String(args.practiceId) : '';
  const practiceName = args.practiceName ? String(args.practiceName) : '';

  const practiceXml = practiceId || practiceName
    ? `<kar:Practice>
              ${practiceId ? `<kar:PracticeID>${escapeXml(practiceId)}</kar:PracticeID>` : ''}
              ${practiceName ? `<kar:PracticeName>${escapeXml(practiceName)}</kar:PracticeName>` : ''}
            </kar:Practice>`
    : '';

  return `
        <kar:request>
          <kar:EncounterUpdateStatus>
            <kar:EncounterID>${escapeXml(encounterId)}</kar:EncounterID>
            <kar:EncounterStatus>${escapeXml(status)}</kar:EncounterStatus>
            ${practiceXml}
          </kar:EncounterUpdateStatus>
        </kar:request>`;
}

// ─── Tool Definitions ───────────────────────────────────────────

export const encounterStatusTools = [
  {
    name: 'tebra_update_encounter_status',
    description:
      "Update the status of an encounter in Tebra. Moves encounters through the billing workflow: Draft → Submitted → Approved (triggers billing) or Rejected (returns to Draft); Unpayable closes it out. Note: Tebra's UI shows Submitted encounters under 'Review'.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        encounterId: {
          type: 'string',
          description: 'Tebra encounter ID',
        },
        status: {
          type: 'string',
          description: 'New status',
          enum: VALID_STATUSES,
        },
        practiceId: {
          type: 'string',
          description: 'Optional practice ID (recommended for multi-practice accounts)',
        },
        practiceName: {
          type: 'string',
          description: 'Optional practice name',
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
    throw new Error('encounterId and status are required.');
  }

  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')} (Tebra's UI 'Review' state corresponds to 'Submitted').`);
  }

  const bodyXml = buildUpdateEncounterStatusBody(args);
  const xml = await soapRequest(config, 'UpdateEncounterStatus', bodyXml);
  const updatedId = extractTag(xml, 'EncounterID') || encounterId;

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
