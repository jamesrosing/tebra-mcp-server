/**
 * Tebra MCP tools: Document create and delete.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const documentTools = [
  {
    name: 'tebra_create_document',
    description:
      'Upload a document to a patient record in Tebra. Supports PDF, JPG, PNG, and TIFF files via base64 content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra patient ID',
        },
        documentLabel: {
          type: 'string',
          description: 'Document category label (e.g. Lab Results, Referral Letter)',
        },
        fileName: {
          type: 'string',
          description: 'File name with extension (e.g. lab_results.pdf)',
        },
        fileContent: {
          type: 'string',
          description: 'Base64-encoded file content',
        },
        fileType: {
          type: 'string',
          description: 'File type: PDF, JPG, PNG, or TIFF',
          enum: ['PDF', 'JPG', 'PNG', 'TIFF'],
        },
        description: {
          type: 'string',
          description: 'Optional document description/notes',
        },
        encounterDate: {
          type: 'string',
          description: 'Optional encounter date to associate with (ISO 8601)',
        },
      },
      required: ['patientId', 'documentLabel', 'fileName', 'fileContent', 'fileType'],
    },
  },
  {
    name: 'tebra_delete_document',
    description:
      'Delete a document from Tebra by document ID.',
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
      const fileType = String(args.fileType ?? '');

      if (!patientId || !documentLabel || !fileName || !fileContent || !fileType) {
        return {
          content: [{
            type: 'text',
            text: 'patientId, documentLabel, fileName, fileContent, and fileType are all required.',
          }],
        };
      }

      const validTypes = ['PDF', 'JPG', 'PNG', 'TIFF'];
      if (!validTypes.includes(fileType)) {
        return {
          content: [{ type: 'text', text: `Invalid fileType "${fileType}". Must be one of: ${validTypes.join(', ')}` }],
        };
      }

      const description = args.description ? String(args.description) : undefined;
      const encounterDate = args.encounterDate ? String(args.encounterDate) : undefined;

      const bodyXml = `
        <kar:request>
          <kar:Document>
            <kar:PatientId>${escapeXml(patientId)}</kar:PatientId>
            <kar:Label>${escapeXml(documentLabel)}</kar:Label>
            <kar:Name>${escapeXml(documentLabel)}</kar:Name>
            <kar:FileName>${escapeXml(fileName)}</kar:FileName>
            <kar:FileContent>${fileContent}</kar:FileContent>
            ${encounterDate ? `<kar:DocumentDate>${escapeXml(encounterDate)}</kar:DocumentDate>` : ''}
            ${description ? `<kar:DocumentNotes>${escapeXml(description)}</kar:DocumentNotes>` : ''}
            <kar:Status>New</kar:Status>
          </kar:Document>
        </kar:request>`;

      const xml = await soapRequest(config, 'CreateDocument', bodyXml);
      const documentId = extractTag(xml, 'DocumentID') || extractTag(xml, 'ID');

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
        return { content: [{ type: 'text', text: 'documentId is required.' }] };
      }

      const bodyXml = `
        <kar:request>
          <kar:DocumentID>${escapeXml(documentId)}</kar:DocumentID>
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
