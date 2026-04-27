/**
 * FHIR DocumentReference — clinical documents (notes, reports, scanned items).
 *
 * Distinct from src/tools/documents.ts (SOAP create/delete document attachments).
 */

import {
  fhirRequest,
  getFhirConfig,
  extractBundleResources,
  formatFhirResult,
  codeDisplay,
  refDisplay,
  type FhirResource,
} from './helpers.js';

export const fhirDocumentTools = [
  {
    name: 'tebra_fhir_get_documents',
    description:
      'Get patient document references from Tebra FHIR API. Returns document type, author, date, and content metadata.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
        type: {
          type: 'string',
          description: 'Document type code filter',
        },
      },
      required: ['patientId'],
    },
  },
];

function summarize(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    type: codeDisplay(r.type),
    status: r.status,
    date: r.date,
    description: r.description,
    author: Array.isArray(r.author)
      ? (r.author as unknown[]).map((a) => refDisplay(a))
      : [],
    contentTypes: Array.isArray(r.content)
      ? (r.content as Array<{ attachment?: { contentType?: string; title?: string } }>).map((c) => ({
          contentType: c.attachment?.contentType,
          title: c.attachment?.title,
        }))
      : [],
  };
}

export async function handleFhirDocumentTool(
  _name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const config = getFhirConfig();
  const patientId = String(args.patientId ?? '');
  if (!patientId) return { content: [{ type: 'text', text: 'patientId is required.' }] };

  const params: Record<string, string> = { patient: patientId };
  if (args.type) params.type = String(args.type);

  const data = await fhirRequest(config, 'DocumentReference', params);
  const resources = extractBundleResources(data);
  return formatFhirResult(resources, 'documents', summarize);
}
