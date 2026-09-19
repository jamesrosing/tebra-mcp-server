/**
 * MCP tool annotations and titles, derived from the tool name.
 *
 * The verb in the name (get/search/check/validate vs create vs update/set
 * vs delete) determines readOnlyHint / destructiveHint / idempotentHint so
 * hosts can distinguish lookups from writes and flag destructive ops.
 * openWorldHint is true throughout — every tool talks to Tebra's live API.
 * `src/__tests__/tool-annotations.test.ts` pins each tool's hints to the
 * upstream operation it actually performs.
 */

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
}

export function annotationsFor(name: string): Omit<ToolAnnotations, 'title'> {
  if (/^tebra_(fhir_)?(get|search|check|validate)_/.test(name)) {
    return { readOnlyHint: true, openWorldHint: true };
  }
  if (/^tebra_delete_/.test(name)) {
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };
  }
  if (/^tebra_(update|set)_/.test(name)) {
    return { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  }
  // create / register — additive, not idempotent (retries create duplicates).
  return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
}

export function titleFor(name: string): string {
  const fhir = name.startsWith('tebra_fhir_');
  const words = name
    .replace(/^tebra_(fhir_)?/, '')
    .split('_')
    .map((w) => (w === 'id' ? 'ID' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
  return fhir ? `${words} (FHIR)` : words;
}

export function annotateTools<T extends { name: string }>(
  tools: readonly T[]
): Array<T & { title: string; annotations: ToolAnnotations }> {
  return tools.map((tool) => ({
    ...tool,
    title: titleFor(tool.name),
    annotations: { title: titleFor(tool.name), ...annotationsFor(tool.name) },
  }));
}
