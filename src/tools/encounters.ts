/**
 * Tebra MCP tools: Encounter creation and retrieval.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const encounterTools = [
  {
    name: 'tebra_get_encounter',
    description:
      'Get encounter details from Tebra by encounter ID, including linked charges, diagnoses, and procedures.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        encounterId: {
          type: 'string',
          description: 'Tebra encounter ID',
        },
      },
      required: ['encounterId'],
    },
  },
  {
    name: 'tebra_create_encounter',
    description:
      'Create a new encounter (superbill) in Tebra with diagnoses and procedures. Returns the created encounter ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra patient ID',
        },
        providerId: {
          type: 'string',
          description: 'Tebra provider ID',
        },
        serviceDate: {
          type: 'string',
          description: 'Date of service (ISO 8601, e.g. 2026-03-25)',
        },
        diagnoses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'ICD-10-CM code' },
              description: { type: 'string', description: 'Diagnosis description' },
            },
            required: ['code', 'description'],
          },
          description: 'Array of diagnosis codes',
        },
        procedures: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'CPT code' },
              modifiers: {
                type: 'array',
                items: { type: 'string' },
                description: 'CPT modifiers (e.g. ["-25", "-59"])',
              },
              units: { type: 'number', description: 'Number of units (default 1)' },
            },
            required: ['code'],
          },
          description: 'Array of procedure codes',
        },
        authorizationId: {
          type: 'string',
          description: 'Optional authorization ID to link',
        },
      },
      required: ['patientId', 'providerId', 'serviceDate', 'diagnoses', 'procedures'],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

interface DiagnosisInput {
  code: string;
  description: string;
}

interface ProcedureInput {
  code: string;
  modifiers?: string[];
  units?: number;
}

export async function handleEncounterTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'tebra_get_encounter': {
      const encounterId = String(args.encounterId ?? '');
      if (!encounterId) {
        return { content: [{ type: 'text', text: 'encounterId is required.' }] };
      }

      const bodyXml = `
        <kar:request>
          <kar:Fields>
            <kar:EncounterID>${escapeXml(encounterId)}</kar:EncounterID>
          </kar:Fields>
        </kar:request>`;

      const xml = await soapRequest(config, 'GetEncounterDetails', bodyXml);
      return { content: [{ type: 'text', text: formatEncounterXml(xml) }] };
    }

    case 'tebra_create_encounter': {
      const patientId = String(args.patientId ?? '');
      const providerId = String(args.providerId ?? '');
      const serviceDate = String(args.serviceDate ?? '');
      const diagnoses = (args.diagnoses ?? []) as DiagnosisInput[];
      const procedures = (args.procedures ?? []) as ProcedureInput[];

      if (!patientId || !providerId || !serviceDate) {
        return {
          content: [{ type: 'text', text: 'patientId, providerId, and serviceDate are required.' }],
        };
      }

      if (diagnoses.length === 0 || procedures.length === 0) {
        return {
          content: [{ type: 'text', text: 'At least one diagnosis and one procedure are required.' }],
        };
      }

      const diagnosisXml = diagnoses
        .map(
          (dx, i) => `
          <kar:EncounterDiagnosisReq>
            <kar:DiagnosisCode>${escapeXml(dx.code)}</kar:DiagnosisCode>
            <kar:Description>${escapeXml(dx.description)}</kar:Description>
            <kar:Sequence>${i + 1}</kar:Sequence>
          </kar:EncounterDiagnosisReq>`
        )
        .join('');

      const procedureXml = procedures
        .map(
          (px) => `
          <kar:EncounterProcedureReq>
            <kar:ProcedureCode>${escapeXml(px.code)}</kar:ProcedureCode>
            ${px.modifiers?.[0] ? `<kar:Modifier1>${escapeXml(px.modifiers[0])}</kar:Modifier1>` : ''}
            ${px.modifiers?.[1] ? `<kar:Modifier2>${escapeXml(px.modifiers[1])}</kar:Modifier2>` : ''}
            ${px.modifiers?.[2] ? `<kar:Modifier3>${escapeXml(px.modifiers[2])}</kar:Modifier3>` : ''}
            ${px.modifiers?.[3] ? `<kar:Modifier4>${escapeXml(px.modifiers[3])}</kar:Modifier4>` : ''}
            <kar:Units>${px.units ?? 1}</kar:Units>
          </kar:EncounterProcedureReq>`
        )
        .join('');

      const authNumber = args.authorizationId ? String(args.authorizationId) : '';

      const bodyXml = `
        <kar:request>
          <kar:Encounter>
            <kar:PatientID>${escapeXml(patientId)}</kar:PatientID>
            <kar:ProviderID>${escapeXml(providerId)}</kar:ProviderID>
            <kar:ServiceStartDate>${escapeXml(serviceDate)}</kar:ServiceStartDate>
            <kar:ServiceEndDate>${escapeXml(serviceDate)}</kar:ServiceEndDate>
            ${authNumber ? `<kar:AuthorizationNumber>${escapeXml(authNumber)}</kar:AuthorizationNumber>` : ''}
            <kar:EncounterDiagnoses>${diagnosisXml}</kar:EncounterDiagnoses>
            <kar:EncounterProcedures>${procedureXml}</kar:EncounterProcedures>
          </kar:Encounter>
        </kar:request>`;

      const xml = await soapRequest(config, 'CreateEncounter', bodyXml);
      const encounterId = extractTag(xml, 'EncounterID') || extractTag(xml, 'ID');
      const status = extractTag(xml, 'Status') || 'created';
      const errorMsg = extractTag(xml, 'ErrorMessage');

      if (errorMsg) {
        return {
          content: [{ type: 'text', text: `Encounter creation error: ${errorMsg}` }],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                encounterId,
                status,
                message: `Encounter created successfully with ${diagnoses.length} diagnoses and ${procedures.length} procedures.`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown encounter tool: ${name}` }] };
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function formatEncounterXml(xml: string): string {
  // Extract key encounter fields for a readable response
  const encounterId = extractTag(xml, 'EncounterID');
  const patientName = extractTag(xml, 'PatientFullName');
  const serviceDate = extractTag(xml, 'ServiceStartDate');
  const status = extractTag(xml, 'Status');

  return JSON.stringify(
    {
      encounterId,
      patientName,
      serviceDate,
      status,
      rawDataAvailable: true,
    },
    null,
    2
  );
}
