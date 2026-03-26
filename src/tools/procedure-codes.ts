/**
 * Tebra MCP tools: Practice procedure code lookup.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const procedureCodeTools = [
  {
    name: 'tebra_get_procedure_codes',
    description:
      'Get procedure codes configured in the Tebra practice. Optionally filter by CPT code or search term. Returns codes with descriptions and default fees.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        searchTerm: {
          type: 'string',
          description: 'Optional CPT code or search term to filter by',
        },
      },
      required: [],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleProcedureCodeTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (name !== 'tebra_get_procedure_codes') {
    return { content: [{ type: 'text', text: `Unknown procedure code tool: ${name}` }] };
  }

  const searchTerm = args.searchTerm ? String(args.searchTerm) : undefined;

  const bodyXml = `
    <kar:request>
      <kar:Fields>
        ${searchTerm ? `<kar:Code>${escapeXml(searchTerm)}</kar:Code>` : ''}
      </kar:Fields>
    </kar:request>`;

  const xml = await soapRequest(config, 'GetProcedureCodes', bodyXml);
  const blocks = extractAllTags(xml, 'ProcedureCodeData');

  const codes = blocks.map((block) => ({
    procedureCodeId: extractTag(block, 'ProcedureCodeID') || extractTag(block, 'ID'),
    code: extractTag(block, 'Code') || extractTag(block, 'ProcedureCode'),
    description: extractTag(block, 'Description') || extractTag(block, 'OfficialDescription'),
    defaultFee: extractTag(block, 'DefaultFee') || '0',
  }));

  if (codes.length === 0) {
    const msg = searchTerm
      ? `No procedure codes found matching "${searchTerm}".`
      : 'No procedure codes configured in the practice.';
    return { content: [{ type: 'text', text: msg }] };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(codes, null, 2) }],
  };
}
