/**
 * Tebra MCP tools: Encounter creation and retrieval.
 *
 * GetEncounterDetails follows the standard list-GET shape; the encounter ID
 * is a Filter member (EncounterDetailsFilter: EncounterID → Practice).
 *
 * CreateEncounter uses the WSDL EncounterCreate shape: identifier groups
 * (Patient/Practice/RenderingProvider/ServiceLocation) plus ServiceLines,
 * where each service line carries its own DiagnosisCode1–4. Members must be
 * emitted in WSDL sequence order (WCF silently drops out-of-order members):
 * Appointment, AuthorizationNumber, Case, EncounterStatus, Patient,
 * PlaceOfService, PostDate, Practice, RenderingProvider, SchedulingProvider,
 * ServiceEndDate, ServiceLines, ServiceLocation, ServiceStartDate, ...
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';
import { buildListGetBody, type FilterSequence } from './filter-helpers.js';

// ─── WSDL Sequence Table (source of truth: ?xsd=xsd0 EncounterDetailsFilter) ──

const ENCOUNTER_FILTER_SEQUENCE: FilterSequence = [
  ['encounterId', 'EncounterID'],
];

// ─── Request Body Builders (exported for tests) ─────────────────

export function buildGetEncounterBody(args: Record<string, unknown>): string {
  return buildListGetBody(ENCOUNTER_FILTER_SEQUENCE, args);
}

interface DiagnosisInput {
  code: string;
  description?: string;
}

interface ProcedureInput {
  code: string;
  modifiers?: string[];
  units?: number;
  unitCharge?: number;
  diagnosisCodes?: string[];
}

export function buildCreateEncounterBody(args: Record<string, unknown>): string {
  const patientId = String(args.patientId ?? '');
  const providerId = String(args.providerId ?? '');
  const serviceDate = String(args.serviceDate ?? '');
  const diagnoses = (args.diagnoses ?? []) as DiagnosisInput[];
  const procedures = (args.procedures ?? []) as ProcedureInput[];

  const authNumber = args.authorizationId ? String(args.authorizationId) : '';
  const practiceId = args.practiceId ? String(args.practiceId) : '';
  const practiceName = args.practiceName ? String(args.practiceName) : '';
  const serviceLocationId = args.serviceLocationId ? String(args.serviceLocationId) : '';
  const placeOfServiceCode = args.placeOfServiceCode ? String(args.placeOfServiceCode) : '';
  const caseId = args.caseId ? String(args.caseId) : '';
  const encounterStatus = args.encounterStatus ? String(args.encounterStatus) : 'Draft';

  // Encounter-level diagnoses become DiagnosisCode1–4 on each service line
  // (unless a line specifies its own diagnosisCodes).
  const encounterDx = diagnoses.map((dx) => dx.code).filter(Boolean);

  const serviceLinesXml = procedures
    .map((px) => {
      const dx = (px.diagnosisCodes && px.diagnosisCodes.length > 0 ? px.diagnosisCodes : encounterDx).slice(0, 4);
      // ServiceLineReq WSDL order: DiagnosisCode1–4, ProcedureCode,
      // ProcedureModifier1–4, ServiceEndDate, ServiceStartDate, UnitCharge, Units.
      return `
            <kar:ServiceLineReq>
              ${dx[0] ? `<kar:DiagnosisCode1>${escapeXml(dx[0])}</kar:DiagnosisCode1>` : ''}
              ${dx[1] ? `<kar:DiagnosisCode2>${escapeXml(dx[1])}</kar:DiagnosisCode2>` : ''}
              ${dx[2] ? `<kar:DiagnosisCode3>${escapeXml(dx[2])}</kar:DiagnosisCode3>` : ''}
              ${dx[3] ? `<kar:DiagnosisCode4>${escapeXml(dx[3])}</kar:DiagnosisCode4>` : ''}
              <kar:ProcedureCode>${escapeXml(px.code)}</kar:ProcedureCode>
              ${px.modifiers?.[0] ? `<kar:ProcedureModifier1>${escapeXml(px.modifiers[0])}</kar:ProcedureModifier1>` : ''}
              ${px.modifiers?.[1] ? `<kar:ProcedureModifier2>${escapeXml(px.modifiers[1])}</kar:ProcedureModifier2>` : ''}
              ${px.modifiers?.[2] ? `<kar:ProcedureModifier3>${escapeXml(px.modifiers[2])}</kar:ProcedureModifier3>` : ''}
              ${px.modifiers?.[3] ? `<kar:ProcedureModifier4>${escapeXml(px.modifiers[3])}</kar:ProcedureModifier4>` : ''}
              <kar:ServiceEndDate>${escapeXml(serviceDate)}</kar:ServiceEndDate>
              <kar:ServiceStartDate>${escapeXml(serviceDate)}</kar:ServiceStartDate>
              ${px.unitCharge != null ? `<kar:UnitCharge>${px.unitCharge}</kar:UnitCharge>` : ''}
              <kar:Units>${px.units ?? 1}</kar:Units>
            </kar:ServiceLineReq>`;
    })
    .join('');

  // EncounterCreate WSDL sequence order (members we emit).
  return `
        <kar:request>
          <kar:Encounter>
            ${authNumber ? `<kar:AuthorizationNumber>${escapeXml(authNumber)}</kar:AuthorizationNumber>` : ''}
            ${caseId ? `<kar:Case><kar:CaseID>${escapeXml(caseId)}</kar:CaseID></kar:Case>` : ''}
            <kar:EncounterStatus>${escapeXml(encounterStatus)}</kar:EncounterStatus>
            <kar:Patient>
              <kar:PatientID>${escapeXml(patientId)}</kar:PatientID>
            </kar:Patient>
            ${placeOfServiceCode ? `<kar:PlaceOfService><kar:PlaceOfServiceCode>${escapeXml(placeOfServiceCode)}</kar:PlaceOfServiceCode></kar:PlaceOfService>` : ''}
            ${practiceId || practiceName ? `<kar:Practice>
              ${practiceId ? `<kar:PracticeID>${escapeXml(practiceId)}</kar:PracticeID>` : ''}
              ${practiceName ? `<kar:PracticeName>${escapeXml(practiceName)}</kar:PracticeName>` : ''}
            </kar:Practice>` : ''}
            <kar:RenderingProvider>
              <kar:ProviderID>${escapeXml(providerId)}</kar:ProviderID>
            </kar:RenderingProvider>
            <kar:ServiceEndDate>${escapeXml(serviceDate)}</kar:ServiceEndDate>
            <kar:ServiceLines>${serviceLinesXml}
            </kar:ServiceLines>
            ${serviceLocationId ? `<kar:ServiceLocation><kar:LocationID>${escapeXml(serviceLocationId)}</kar:LocationID></kar:ServiceLocation>` : ''}
            <kar:ServiceStartDate>${escapeXml(serviceDate)}</kar:ServiceStartDate>
          </kar:Encounter>
        </kar:request>`;
}

// ─── Tool Definitions ───────────────────────────────────────────

export const encounterTools = [
  {
    name: 'tebra_get_encounter',
    description:
      'Get encounter details from Tebra by encounter ID, including patient, providers, status, service dates, place of service, and service line IDs.',
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
      'Create a new encounter (superbill) in Tebra with diagnoses and procedures. Each procedure becomes a service line carrying up to 4 ICD-10 diagnosis codes (from the encounter-level diagnoses array, or per-procedure diagnosisCodes). practiceName or practiceId is strongly recommended — Tebra requires the practice on most accounts. Returns the created encounter ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra patient ID',
        },
        providerId: {
          type: 'string',
          description: 'Rendering provider ID',
        },
        serviceDate: {
          type: 'string',
          description: 'Date of service (ISO 8601, e.g. 2026-03-25)',
        },
        practiceName: {
          type: 'string',
          description: 'Practice name (strongly recommended; required by Tebra on most accounts)',
        },
        practiceId: {
          type: 'string',
          description: 'Practice ID (alternative to practiceName)',
        },
        serviceLocationId: {
          type: 'string',
          description: 'Optional service location ID',
        },
        placeOfServiceCode: {
          type: 'string',
          description: 'Optional place of service code (e.g. 11 for office)',
        },
        caseId: {
          type: 'string',
          description: 'Optional patient case ID to bill under',
        },
        encounterStatus: {
          type: 'string',
          enum: ['Draft', 'Submitted', 'Approved'],
          description: "Initial encounter status (default 'Draft'; 'Approved' triggers billing)",
        },
        diagnoses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'ICD-10-CM code' },
              description: { type: 'string', description: 'Diagnosis description (informational only — not sent to Tebra)' },
            },
            required: ['code'],
          },
          description: 'Encounter-level diagnosis codes; the first 4 are applied to each service line',
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
                description: 'CPT modifiers (e.g. ["25", "59"])',
              },
              units: { type: 'number', description: 'Number of units (default 1)' },
              unitCharge: { type: 'number', description: 'Optional unit charge in dollars (defaults to fee schedule)' },
              diagnosisCodes: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional per-line ICD-10 codes (max 4; overrides encounter-level diagnoses)',
              },
            },
            required: ['code'],
          },
          description: 'Array of procedures; each becomes one service line',
        },
        authorizationId: {
          type: 'string',
          description: 'Optional authorization number to link',
        },
      },
      required: ['patientId', 'providerId', 'serviceDate', 'diagnoses', 'procedures'],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleEncounterTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'tebra_get_encounter': {
      const encounterId = String(args.encounterId ?? '');
      if (!encounterId) {
        throw new Error('encounterId is required.');
      }

      const bodyXml = buildGetEncounterBody(args);
      const xml = await soapRequest(config, 'GetEncounterDetails', bodyXml);
      const encounters = parseEncounterDetails(xml);

      if (encounters.length === 0) {
        return { content: [{ type: 'text', text: `Encounter not found: ${encounterId}` }] };
      }

      return { content: [{ type: 'text', text: JSON.stringify(encounters, null, 2) }] };
    }

    case 'tebra_create_encounter': {
      const patientId = String(args.patientId ?? '');
      const providerId = String(args.providerId ?? '');
      const serviceDate = String(args.serviceDate ?? '');
      const diagnoses = (args.diagnoses ?? []) as DiagnosisInput[];
      const procedures = (args.procedures ?? []) as ProcedureInput[];

      if (!patientId || !providerId || !serviceDate) {
        throw new Error('patientId, providerId, and serviceDate are required.');
      }

      if (procedures.length === 0) {
        throw new Error('At least one procedure is required.');
      }

      const hasLineDx = procedures.every((px) => px.diagnosisCodes && px.diagnosisCodes.length > 0);
      if (diagnoses.length === 0 && !hasLineDx) {
        throw new Error('At least one diagnosis is required (encounter-level diagnoses or per-procedure diagnosisCodes).');
      }

      const bodyXml = buildCreateEncounterBody(args);
      const xml = await soapRequest(config, 'CreateEncounter', bodyXml);
      const encounterId = extractTag(xml, 'EncounterID');
      const serviceLinesAdded = extractAllTags(xml, 'ServiceLineRes').length;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                encounterId,
                serviceLinesAdded,
                message: `Encounter created with ${procedures.length} service line(s).`,
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

// ─── Parsers ────────────────────────────────────────────────────

// GetEncounterDetails returns EncounterStatus as a 1-based numeric code
// (verified live: 3 on an encounter whose charges report 'Approved').
const ENCOUNTER_STATUS_LABELS: Record<string, string> = {
  '1': 'Draft',
  '2': 'Submitted',
  '3': 'Approved',
  '4': 'Rejected',
  '5': 'Unpayable',
};

function parseEncounterDetails(xml: string): Array<Record<string, unknown>> {
  return extractAllTags(xml, 'EncounterDetailsData')
    .map((block) => ({
      encounterId: extractTag(block, 'EncounterID'),
      encounterStatus: ENCOUNTER_STATUS_LABELS[extractTag(block, 'EncounterStatus')] ?? extractTag(block, 'EncounterStatus'),
      patientId: extractTag(block, 'PatientID'),
      patientName: `${extractTag(block, 'PatientFirstName')} ${extractTag(block, 'PatientLastName')}`.trim(),
      practiceName: extractTag(block, 'PracticeName'),
      caseId: extractTag(block, 'CaseID'),
      caseName: extractTag(block, 'CaseName'),
      casePayerScenario: extractTag(block, 'CasePayerScenario'),
      appointmentId: extractTag(block, 'AppointmentID'),
      renderingProvider: extractTag(block, 'RenderingProvider'),
      schedulingProvider: extractTag(block, 'SchedulingProvider'),
      referringProvider: extractTag(block, 'ReferringProvider'),
      serviceStartDate: extractTag(block, 'ServiceStartDate'),
      serviceEndDate: extractTag(block, 'ServiceEndDate'),
      postDate: extractTag(block, 'PostDate'),
      placeOfServiceCode: extractTag(block, 'PlaceOfServiceCode'),
      placeOfServiceName: extractTag(block, 'PlaceOfServiceName'),
      serviceLocationName: extractTag(block, 'ServiceLocationName'),
      serviceLineIds: extractAllTags(block, 'ServiceLineRes').map((line) => extractTag(line, 'ServiceLineID')),
      createdDate: extractTag(block, 'CreatedDate'),
      lastModifiedDate: extractTag(block, 'LastModifiedDate'),
    }))
    // Drop the phantom placeholder block Tebra emits on empty result sets.
    .filter((enc) => enc.encounterId !== '');
}
