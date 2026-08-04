/**
 * Shared FHIR primitives used by every per-resource tool module.
 *
 * Per-resource files (allergies.ts, medications.ts, ...) import from here
 * for Bundle parsing, code/reference extraction, date-range params, the
 * MCP result formatter, and the Observation summarizer (shared by vitals
 * and lab-results).
 */

import { fhirRequest, fhirRequestUrl, getFhirConfig } from '../../fhir-client.js';

export interface FhirResource {
  resourceType: string;
  [key: string]: unknown;
}

export interface FhirBundleEntry {
  resource?: FhirResource;
  [key: string]: unknown;
}

export interface FhirBundle {
  resourceType: string;
  total?: number;
  entry?: FhirBundleEntry[];
  [key: string]: unknown;
}

export function extractBundleResources(bundle: unknown): FhirResource[] {
  const b = bundle as FhirBundle;
  if (!b?.entry || !Array.isArray(b.entry)) return [];
  return b.entry
    .filter((e: FhirBundleEntry) => e.resource)
    .map((e: FhirBundleEntry) => e.resource as FhirResource);
}

export function codeDisplay(concept: unknown): string {
  if (!concept || typeof concept !== 'object') return '';
  const c = concept as { text?: string; coding?: Array<{ display?: string; code?: string }> };
  if (c.text) return c.text;
  if (c.coding?.[0]?.display) return c.coding[0].display;
  if (c.coding?.[0]?.code) return c.coding[0].code;
  return '';
}

export function codeValue(concept: unknown): string {
  if (!concept || typeof concept !== 'object') return '';
  const c = concept as { coding?: Array<{ code?: string }> };
  return c.coding?.[0]?.code ?? '';
}

export function refDisplay(ref: unknown): string {
  if (!ref || typeof ref !== 'object') return '';
  const r = ref as { display?: string; reference?: string };
  return r.display ?? r.reference ?? '';
}

export function addDateRange(
  params: Record<string, string | string[]>,
  args: Record<string, unknown>,
  paramName = 'date',
): void {
  // A from+to range needs TWO date params (date=ge...&date=le...). These are
  // passed as an array so the client emits repeated query params — string
  // concatenation here would get percent-encoded into one malformed value.
  const range: string[] = [];
  if (args.fromDate) range.push(`ge${String(args.fromDate)}`);
  if (args.toDate) range.push(`le${String(args.toDate)}`);
  if (range.length === 1) params[paramName] = range[0];
  if (range.length > 1) params[paramName] = range;
}

const MAX_BUNDLE_PAGES = 10;

/**
 * Run a FHIR search and collect resources across all Bundle pages
 * (following link[relation=next], capped at MAX_BUNDLE_PAGES).
 */
export async function searchFhir(
  resource: string,
  params: Record<string, string | string[]>,
): Promise<{ resources: FhirResource[]; truncated: boolean }> {
  const config = getFhirConfig();
  const resources: FhirResource[] = [];
  let bundle = await fhirRequest(config, resource, params) as FhirBundle;
  let pages = 1;

  for (;;) {
    resources.push(...extractBundleResources(bundle));
    const next = Array.isArray(bundle?.link)
      ? (bundle.link as Array<{ relation?: string; url?: string }>).find((l) => l.relation === 'next')?.url
      : undefined;
    if (!next) return { resources, truncated: false };
    if (pages >= MAX_BUNDLE_PAGES) return { resources, truncated: true };
    bundle = await fhirRequestUrl(config, next) as FhirBundle;
    pages++;
  }
}

export function formatFhirResult(
  resources: FhirResource[],
  label: string,
  summarizer: (r: FhirResource) => Record<string, unknown>,
  truncated = false,
): { content: Array<{ type: string; text: string }> } {
  if (resources.length === 0) {
    return {
      content: [{ type: 'text', text: `No ${label} found for this patient.` }],
    };
  }

  const summarized = resources.map(summarizer);
  const text = JSON.stringify(summarized, null, 2);
  return {
    content: [{
      type: 'text',
      text: truncated
        ? `${text}\n\nNote: result set truncated after ${resources.length} entries — narrow the date range to see the rest.`
        : text,
    }],
  };
}

export function summarizeObservation(r: FhirResource): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: r.id,
    type: codeDisplay(r.code),
    code: codeValue(r.code),
    status: r.status,
    effectiveDateTime: r.effectiveDateTime,
    issued: r.issued,
  };

  if (r.valueQuantity) {
    const vq = r.valueQuantity as { value?: number; unit?: string };
    result.value = vq.value;
    result.unit = vq.unit;
  } else if (r.valueCodeableConcept) {
    result.value = codeDisplay(r.valueCodeableConcept);
  } else if (r.valueString) {
    result.value = r.valueString;
  }

  if (Array.isArray(r.referenceRange)) {
    result.referenceRange = (r.referenceRange as Array<{
      low?: { value?: number; unit?: string };
      high?: { value?: number; unit?: string };
      text?: string;
    }>).map((rr) => ({
      low: rr.low ? `${rr.low.value} ${rr.low.unit ?? ''}`.trim() : undefined,
      high: rr.high ? `${rr.high.value} ${rr.high.unit ?? ''}`.trim() : undefined,
      text: rr.text,
    }));
  }

  if (Array.isArray(r.component)) {
    result.components = (r.component as Array<{
      code?: unknown;
      valueQuantity?: { value?: number; unit?: string };
    }>).map((comp) => ({
      type: codeDisplay(comp.code),
      value: comp.valueQuantity?.value,
      unit: comp.valueQuantity?.unit,
    }));
  }

  return result;
}

export { fhirRequest, getFhirConfig };
