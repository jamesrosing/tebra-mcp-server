/**
 * Tebra MCP tools: Document create and delete.
 *
 * CreateDocumentReq wraps a <DocumentToCreate> element (DocumentCreateRequest,
 * WSDL sequence: DocumentDate → DocumentNotes → FileContent → FileName →
 * Label → Name → PatientId → PracticeId → Status). Label is the WSDL
 * DocumentLabel enum (CamelCase, no spaces). DeleteDocumentReq takes a bare
 * <DocumentId> (lowercase 'd' — WCF member matching is case-sensitive).
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag } from '../soap-client.js';

// The most commonly used values from the WSDL DocumentLabel enum. Any exact
// enum value is accepted; this list feeds the schema description.
const COMMON_LABELS = [
  'MedicalReport', 'PatientAuthorizationOrReferral', 'PatientCorrespondence',
  'PatientDemographics', 'PatientInsuranceCard', 'PatientDriversLicense',
  'Superbill', 'ExplanationofBenefits', 'InsuranceCorrespondence',
  'OperativeReport', 'HistoryandPhysical', 'Consultation', 'ReferralLetter',
  'PathologyReport', 'MiscLabResult', 'Order', 'Prescriptions', 'Tests',
  'ClinicalSummary', 'Other',
];

// ─── Request Body Builder (exported for tests) ──────────────────

export function buildCreateDocumentBody(args: Record<string, unknown>): string {
  const patientId = String(args.patientId ?? '');
  // The Tebra DocumentLabel enum has no spaces — normalize common input like
  // "Lab Results" or "operative report" toward the enum's CamelCase style.
  const documentLabel = String(args.documentLabel ?? '').replace(/\s+/g, '');
  const fileName = String(args.fileName ?? '');
  const fileContent = String(args.fileContent ?? '');
  const documentName = args.documentName ? String(args.documentName) : fileName;
  const description = args.description ? String(args.description) : '';
  const documentDate = args.encounterDate ? String(args.encounterDate) : '';
  const practiceId = args.practiceId ? String(args.practiceId) : '';

  return `
        <kar:request>
          <kar:DocumentToCreate>
            ${documentDate ? `<kar:DocumentDate>${escapeXml(documentDate)}</kar:DocumentDate>` : ''}
            ${description ? `<kar:DocumentNotes>${escapeXml(description)}</kar:DocumentNotes>` : ''}
            <kar:FileContent>${fileContent}</kar:FileContent>
            <kar:FileName>${escapeXml(fileName)}</kar:FileName>
            <kar:Label>${escapeXml(documentLabel)}</kar:Label>
            <kar:Name>${escapeXml(documentName)}</kar:Name>
            <kar:PatientId>${escapeXml(patientId)}</kar:PatientId>
            ${practiceId ? `<kar:PracticeId>${escapeXml(practiceId)}</kar:PracticeId>` : ''}
            <kar:Status>New</kar:Status>
          </kar:DocumentToCreate>
        </kar:request>`;
}

// ─── Tool Definitions ───────────────────────────────────────────

export const documentTools = [
  {
    name: 'tebra_create_document',
    description:
      `Upload a document to a patient record in Tebra via base64 content (PDF, JPG, PNG, TIFF — type inferred from the file extension). documentLabel must be a Tebra DocumentLabel enum value (CamelCase, no spaces), e.g.: ${COMMON_LABELS.slice(0, 10).join(', ')}, ... Use 'Other' when unsure.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra patient ID',
        },
        documentLabel: {
          type: 'string',
          description: `Document category label from the Tebra DocumentLabel enum (e.g. ${COMMON_LABELS.slice(0, 6).join(', ')}, Other). Spaces are stripped automatically.`,
        },
        fileName: {
          type: 'string',
          description: 'File name with extension (e.g. lab_results.pdf) — the extension determines the file type',
        },
        fileContent: {
          type: 'string',
          description: 'Base64-encoded file content',
        },
        documentName: {
          type: 'string',
          description: 'Optional display name for the document (defaults to fileName)',
        },
        description: {
          type: 'string',
          description: 'Optional document description/notes',
        },
        encounterDate: {
          type: 'string',
          description: 'Optional document date to associate with (ISO 8601)',
        },
        practiceId: {
          type: 'string',
          description: 'Optional practice ID (recommended for multi-practice accounts)',
        },
      },
      required: ['patientId', 'documentLabel', 'fileName', 'fileContent'],
    },
  },
  {
    name: 'tebra_delete_document',
    description:
      'Delete a document from Tebra by document ID. This is irreversible.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        documentId: {
          type: 'string',
          description: 'Tebra document ID to delete',
        },
      },
      required: ['documentId'],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleDocumentTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'tebra_create_document': {
      const patientId = String(args.patientId ?? '');
      const documentLabel = String(args.documentLabel ?? '');
      const fileName = String(args.fileName ?? '');
      const fileContent = String(args.fileContent ?? '');

      if (!patientId || !documentLabel || !fileName || !fileContent) {
        throw new Error('patientId, documentLabel, fileName, and fileContent are all required.');
      }

      const bodyXml = buildCreateDocumentBody(args);
      const xml = await soapRequest(config, 'CreateDocument', bodyXml);
      const documentId = extractTag(xml, 'DocumentId') || extractTag(xml, 'DocumentID');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            documentId,
            message: 'Document uploaded successfully.',
          }, null, 2),
        }],
      };
    }

    case 'tebra_delete_document': {
      const documentId = String(args.documentId ?? '');
      if (!documentId) {
        throw new Error('documentId is required.');
      }

      // DeleteDocumentReq member is DocumentId — lowercase 'd'.
      const bodyXml = `
        <kar:request>
          <kar:DocumentId>${escapeXml(documentId)}</kar:DocumentId>
        </kar:request>`;

      await soapRequest(config, 'DeleteDocument', bodyXml);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            documentId,
            message: 'Document deleted successfully.',
          }, null, 2),
        }],
      };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown document tool: ${name}` }] };
  }
}
