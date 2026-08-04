/**
 * Tebra MCP tools: Practice procedure code lookup.
 *
 * Criteria go in <kar:Filter> in WSDL ProcedureCodeFilter sequence order
 * (source: ?xsd=xsd7) — see filter-helpers.ts. The code filter member is
 * `ProcedureCode` (the old build sent a nonexistent `Code` toggle inside
 * Fields, so the search term was silently ignored).
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, extractTag, extractAllTags } from '../soap-client.js';
import { buildListGetBody, type FilterSequence } from './filter-helpers.js';

// ─── WSDL Sequence Table (source of truth: ?xsd=xsd7 ProcedureCodeFilter) ──

const PROCEDURE_CODE_FILTER_SEQUENCE: FilterSequence = [
  ['active', 'Active'],
  ['customerSpecific', 'CustomerSpecific'],
  ['fromCreatedDate', 'FromCreatedDate'],
  ['fromLastModifiedDate', 'FromLastModifiedDate'],
  ['procedureCodeId', 'ID'],
  ['searchTerm', 'ProcedureCode'],
  ['toCreatedDate', 'ToCreatedDate'],
  ['toLastModifiedDate', 'ToLastModifiedDate'],
];

// ─── Request Body Builder (exported for tests) ──────────────────

export function buildGetProcedureCodesBody(args: Record<string, unknown>): string {
  return buildListGetBody(PROCEDURE_CODE_FILTER_SEQUENCE, args);
}

// ─── Tool Definitions ───────────────────────────────────────────

export const procedureCodeTools = [
  {
    name: 'tebra_get_procedure_codes',
    description:
      'Get procedure codes configured in the Tebra practice. Optionally filter by CPT code, active status, or customer-specific codes. Returns codes with official names, descriptions, and default units.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        searchTerm: {
          type: 'string',
          description: 'Optional CPT/procedure code to filter by (e.g. 99213)',
        },
        active: {
          type: 'boolean',
          description: 'Optional filter for active codes only',
        },
        customerSpecific: {
          type: 'boolean',
          description: 'Optional filter for customer-specific codes',
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

  const bodyXml = buildGetProcedureCodesBody(args);
  const xml = await soapRequest(config, 'GetProcedureCodes', bodyXml);
  const blocks = extractAllTags(xml, 'ProcedureCodeData');

  const codes = blocks
    .map((block) => ({
      procedureCodeId: extractTag(block, 'ID'),
      code: extractTag(block, 'ProcedureCode'),
      officialName: extractTag(block, 'OfficialName'),
      description: extractTag(block, 'OfficialDescription'),
      localName: extractTag(block, 'LocalName'),
      defaultUnits: extractTag(block, 'DefaultUnits'),
      typeOfServiceCode: extractTag(block, 'TypeOfServiceCode'),
      active: extractTag(block, 'Active'),
      customerSpecific: extractTag(block, 'CustomerSpecific'),
    }))
    // Drop the phantom placeholder block Tebra emits on empty result sets.
    .filter((code) => code.procedureCodeId !== '' || code.code !== '');

  if (codes.length === 0) {
    const searchTerm = args.searchTerm ? String(args.searchTerm) : '';
    const msg = searchTerm
      ? `No procedure codes found matching "${searchTerm}".`
      : 'No procedure codes configured in the practice.';
    return { content: [{ type: 'text', text: msg }] };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(codes, null, 2) }],
  };
}
