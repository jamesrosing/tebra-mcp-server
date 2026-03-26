/**
 * Tebra MCP tools: Patient search and retrieval.
 */

import type { TebraConfig } from '../config.js';
import {
  soapRequest,
  escapeXml,
  extractTag,
  extractAllTags,
  extractNumber,
} from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const patientTools = [
  {
    name: 'tebra_search_patients',
    description:
      'Search for patients in Tebra by name, DOB, MRN, or external ID. Returns demographics and insurance policies.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query — patient name, date of birth, MRN, or external ID',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'tebra_get_patient',
    description:
      'Get full patient record from Tebra by patient ID, including insurance policies, cases, and authorizations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra patient ID',
        },
      },
      required: ['patientId'],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handlePatientTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'tebra_search_patients': {
      const query = String(args.query ?? '');
      if (!query || query.length < 2) {
        return {
          content: [{ type: 'text', text: 'Search query must be at least 2 characters.' }],
        };
      }

      const bodyXml = `
        <kar:request>
          <kar:Fields>
            <kar:PatientFullName>${escapeXml(query)}</kar:PatientFullName>
          </kar:Fields>
        </kar:request>`;

      const xml = await soapRequest(config, 'GetPatients', bodyXml);
      const patients = parsePatientList(xml);

      return {
        content: [
          {
            type: 'text',
            text: patients.length === 0
              ? `No patients found for query: "${query}"`
              : JSON.stringify(patients, null, 2),
          },
        ],
      };
    }

    case 'tebra_get_patient': {
      const patientId = String(args.patientId ?? '');
      if (!patientId) {
        return {
          content: [{ type: 'text', text: 'patientId is required.' }],
        };
      }

      const bodyXml = `
        <kar:request>
          <kar:Fields>
            <kar:PatientID>${escapeXml(patientId)}</kar:PatientID>
          </kar:Fields>
        </kar:request>`;

      const xml = await soapRequest(config, 'GetPatient', bodyXml);
      const patientBlock = extractTag(xml, 'Patient');

      if (!patientBlock) {
        return {
          content: [{ type: 'text', text: `Patient not found: ${patientId}` }],
        };
      }

      const patient = parsePatientBlock(patientBlock);
      return {
        content: [{ type: 'text', text: JSON.stringify(patient, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown patient tool: ${name}` }],
      };
  }
}

// ─── Parsers ────────────────────────────────────────────────────

interface PatientResult {
  patientId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  mrn: string;
  insurances: Array<{
    payerName: string;
    memberId: string;
    isPrimary: boolean;
  }>;
  authorizations: Array<{
    authNumber: string;
    insurancePlan: string;
    status: string;
    approvedVisits: number;
    usedVisits: number;
    remainingVisits: number;
    startDate: string;
    endDate: string;
  }>;
}

function parsePatientList(xml: string): PatientResult[] {
  const blocks = extractAllTags(xml, 'PatientData');
  return blocks.map(parsePatientBlock);
}

function parsePatientBlock(block: string): PatientResult {
  const insuranceBlocks = extractAllTags(block, 'InsurancePolicyData');
  const caseBlocks = extractAllTags(block, 'CaseData');

  const authorizations: PatientResult['authorizations'] = [];
  for (const caseBlock of caseBlocks) {
    const authBlocks = extractAllTags(caseBlock, 'AuthorizationData');
    for (const authBlock of authBlocks) {
      const approved = extractNumber(authBlock, 'ApprovedVisits');
      const used = extractNumber(authBlock, 'UsedVisits');
      authorizations.push({
        authNumber: extractTag(authBlock, 'AuthorizationNumber'),
        insurancePlan: extractTag(authBlock, 'InsurancePlanName'),
        status: computeAuthStatus(authBlock, approved, used),
        approvedVisits: approved,
        usedVisits: used,
        remainingVisits: Math.max(0, approved - used),
        startDate: extractTag(authBlock, 'StartDate'),
        endDate: extractTag(authBlock, 'EndDate'),
      });
    }
  }

  return {
    patientId: extractTag(block, 'PatientID') || extractTag(block, 'ID'),
    firstName: extractTag(block, 'FirstName'),
    lastName: extractTag(block, 'LastName'),
    dateOfBirth: extractTag(block, 'DateofBirth') || extractTag(block, 'DOB'),
    mrn: extractTag(block, 'MRN'),
    insurances: insuranceBlocks.map((ins) => ({
      payerName: extractTag(ins, 'PayerName') || extractTag(ins, 'CompanyName'),
      memberId: extractTag(ins, 'MemberNumber') || extractTag(ins, 'PolicyNumber'),
      isPrimary: (extractNumber(ins, 'SequenceNumber') || 1) === 1,
    })),
    authorizations,
  };
}

function computeAuthStatus(block: string, approved: number, used: number): string {
  const remaining = approved - used;
  if (remaining <= 0) return 'exhausted';
  const endDate = extractTag(block, 'EndDate');
  if (endDate && new Date(endDate) < new Date()) return 'expired';
  const authNumber = extractTag(block, 'AuthorizationNumber');
  if (!authNumber) return 'pending';
  return 'active';
}
