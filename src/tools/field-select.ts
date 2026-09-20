/**
 * Client-side field selection for record-returning tools.
 *
 * Tebra ignores server-side column toggles (an empty <kar:Fields/> is the
 * only shape that returns real data — CLAUDE.md quirk #4), so the
 * "minimum necessary" projection happens here, after parsing. Tools
 * accept an optional `fields` list of dotted paths; a path that crosses
 * an array applies to every element.
 */

/** Schema fragment to spread into a tool's inputSchema.properties. */
export const FIELDS_ARG = {
  fields: {
    type: 'array' as const,
    items: { type: 'string' as const },
    description:
      'Optional list of result fields to return (dotted paths for nested values, e.g. "cases.policies.companyName"). Omit for the default field set. Request only the fields you need — results contain protected health information.',
  },
};

type Json = Record<string, unknown>;

/** Return a copy of `record` containing only the given dotted paths. */
export function pickFields(record: Json, paths: readonly string[]): Json {
  const out: Json = {};
  for (const path of paths) {
    const [head, ...rest] = path.split('.');
    if (!(head in record)) continue;
    const value = record[head];
    if (rest.length === 0) {
      out[head] = value;
      continue;
    }
    const projected = project(value, rest.join('.'));
    if (projected === undefined) continue;
    out[head] = mergeInto(out[head], projected);
  }
  return out;
}

function project(value: unknown, path: string): unknown {
  if (Array.isArray(value)) return value.map((v) => project(v, path));
  if (value && typeof value === 'object') return pickFields(value as Json, [path]);
  return undefined;
}

// Two paths under the same head ("cases.caseId", "cases.policies.x") are unioned.
function mergeInto(existing: unknown, incoming: unknown): unknown {
  if (existing === undefined) return incoming;
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    return existing.map((e, i) => mergeInto(e, incoming[i]));
  }
  if (existing && incoming && typeof existing === 'object' && typeof incoming === 'object') {
    return { ...(existing as Json), ...(incoming as Json) };
  }
  return incoming;
}

/**
 * Apply a tool's `fields` argument to a list of records. Undefined means
 * "return the records as parsed" (the same array instance, so callers can
 * cheaply detect no-op).
 */
export function selectFields<T extends object>(records: T[], fields: unknown): Array<T | Json> {
  if (fields === undefined || fields === null) return records;
  if (!Array.isArray(fields) || !fields.every((f) => typeof f === 'string')) {
    throw new Error('fields must be an array of field-name strings.');
  }
  return records.map((r) => pickFields(r as Json, fields));
}

/** Delete the given dotted paths from a record in place (for default omissions). */
export function omitFields<T extends object>(target: T, paths: readonly string[]): T {
  const record = target as Json;
  for (const path of paths) {
    const [head, ...rest] = path.split('.');
    if (!(head in record)) continue;
    if (rest.length === 0) {
      delete record[head];
      continue;
    }
    const value = record[head];
    const tail = rest.join('.');
    if (Array.isArray(value)) value.forEach((v) => v && typeof v === 'object' && omitFields(v as Json, [tail]));
    else if (value && typeof value === 'object') omitFields(value as Json, [tail]);
  }
  return target;
}
