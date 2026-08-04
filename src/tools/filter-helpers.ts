/**
 * Shared request-body builders for Tebra list-GET operations.
 *
 * Every GetFilteredX operation takes the same two-member request shape
 * (Fields then Filter, per the *Req complexType sequence), and all three
 * wire-format quirks from CLAUDE.md apply:
 *   - <kar:Fields /> must be EMPTY (quirk #4: any explicit column toggle
 *     triggers an empty projection server-side; empty Fields returns the
 *     full default projection).
 *   - <kar:Filter /> must be present even when no criteria are set
 *     (quirk #3: server-side NullReferenceException without it).
 *   - Filter members must appear in WSDL <xs:sequence> order — WCF's
 *     DataContractSerializer silently skips out-of-order members.
 *
 * charges.ts predates this module and keeps its own equivalent builder
 * (its exports are pinned by regression tests); new/repaired GET tools
 * build on these helpers instead.
 */

import { escapeXml } from '../soap-client.js';

/** [MCP arg key, WSDL Filter element name] pairs in WSDL sequence order. */
export type FilterSequence = ReadonlyArray<readonly [string, string]>;

/**
 * Render the <kar:Filter> block for a list-GET request. Values are pulled
 * from args by key, in the order given (which MUST be WSDL sequence order).
 * Booleans serialize as 'true'/'false' unless a transform overrides them.
 */
export function buildFilterXml(
  sequence: FilterSequence,
  args: Record<string, unknown>,
  transform?: (argKey: string, value: unknown) => string,
  prefix = 'kar',
): string {
  const parts: string[] = [];
  for (const [argKey, element] of sequence) {
    const raw = args[argKey];
    if (raw === undefined || raw === null || raw === '') continue;
    const val = transform
      ? transform(argKey, raw)
      : typeof raw === 'boolean'
        ? (raw ? 'true' : 'false')
        : String(raw);
    parts.push(`<${prefix}:${element}>${escapeXml(val)}</${prefix}:${element}>`);
  }

  if (parts.length === 0) return `<${prefix}:Filter />`;
  return `<${prefix}:Filter>\n        ${parts.join('\n        ')}\n      </${prefix}:Filter>`;
}

/**
 * Full list-GET request body: empty Fields followed by the Filter block.
 *
 * prefix selects the member namespace: 'kar' for xsd0 types (trailing-slash
 * namespace), 'kar7' for the xsd7 types (ServiceLocation / ProcedureCode),
 * whose targetNamespace has NO trailing slash — see soap-client.ts. The
 * <kar:request> wrapper itself is always in the xsd0 namespace.
 */
export function buildListGetBody(
  sequence: FilterSequence,
  args: Record<string, unknown>,
  transform?: (argKey: string, value: unknown) => string,
  prefix = 'kar',
): string {
  return `
    <kar:request>
      <${prefix}:Fields />
      ${buildFilterXml(sequence, args, transform, prefix)}
    </kar:request>`;
}

/**
 * Fail closed on an arg that has no corresponding WSDL Filter member.
 * Silently ignoring a filter is how these tools spent their history
 * returning unfiltered data — an explicit error is always better.
 */
export function rejectUnsupportedFilterArg(
  args: Record<string, unknown>,
  argKey: string,
  toolName: string,
  guidance: string,
): void {
  const val = args[argKey];
  if (val !== undefined && val !== null && val !== '') {
    throw new Error(`${toolName}: '${argKey}' ${guidance}`);
  }
}

