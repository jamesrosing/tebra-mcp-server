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
      'Search for patients in Tebra with flexible filters. Use query/fullName for name search, or combine specific filters like firstName, lastName, DOB, MRN, insurance, etc. Returns demographics and insurance policies.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search by full name (backward-compatible alias for fullName)',
        },
        firstName: {
          type: 'string',
          description: 'Filter by first name',
        },
        lastName: {
          type: 'string',
          description: 'Filter by last name',
        },
        fullName: {
          type: 'string',
          description: 'Search by full name',
        },
        dateOfBirth: {
          type: 'string',
          description: 'Exact date of birth (YYYY-MM-DD)',
        },
        fromDateOfBirth: {
          type: 'string',
          description: 'DOB range start (YYYY-MM-DD)',
        },
        toDateOfBirth: {
          type: 'string',
          description: 'DOB range end (YYYY-MM-DD)',
        },
        gender: {
          type: 'string',
          enum: ['Male', 'Female', 'Other', 'Unknown'],
          description: 'Filter by gender',
        },
        mrn: {
          type: 'string',
          description: 'Medical Record Number',
        },
        externalId: {
          type: 'string',
          description: 'External system ID',
        },
        isActive: {
          type: 'boolean',
          description: 'Filter by active/inactive status',
        },
        practiceName: {
          type: 'string',
          description: 'Practice name filter',
        },
        insuranceCompanyName: {
          type: 'string',
          description: 'Insurance company name filter',
        },
        referringProviderName: {
          type: 'string',
          description: 'Referring provider name filter',
        },
        fromLastModifiedDate: {
          type: 'string',
          description: 'Modified date range start (YYYY-MM-DD)',
        },
        toLastModifiedDate: {
          type: 'string',
          description: 'Modified date range end (YYYY-MM-DD)',
        },
        fromCreatedDate: {
          type: 'string',
          description: 'Created date range start (YYYY-MM-DD)',
        },
        toCreatedDate: {
          type: 'string',
          description: 'Created date range end (YYYY-MM-DD)',
        },
      },
      required: [],
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
      // Map of arg names to SOAP filter field names
      const filterMap: Array<[string, string]> = [
        ['firstName', 'FirstName'],
        ['lastName', 'LastName'],
        ['fullName', 'FullName'],
        ['query', 'PatientFullName'],       // backward compat
        ['dateOfBirth', 'DateofBirth'],
        ['fromDateOfBirth', 'FromDateofBirth'],
        ['toDateOfBirth', 'ToDateofBirth'],
        ['gender', 'Gender'],
        ['mrn', 'MRN'],
        ['externalId', 'ExternalID'],
        ['practiceName', 'PracticeName'],
        ['insuranceCompanyName', 'InsuranceCompanyName'],
        ['referringProviderName', 'ReferringProviderFullName'],
        ['fromLastModifiedDate', 'FromLastModifiedDate'],
        ['toLastModifiedDate', 'ToLastModifiedDate'],
        ['fromCreatedDate', 'FromCreatedDate'],
        ['toCreatedDate', 'ToCreatedDate'],
      ];

      const filterFields: string[] = [];
      for (const [argKey, soapField] of filterMap) {
        const val = args[argKey];
        if (val !== undefined && val !== null && val !== '') {
          filterFields.push(`<kar:${soapField}>${escapeXml(String(val))}</kar:${soapField}>`);
        }
      }

      // Handle boolean isActive -> Active (true/false string)
      if (args.isActive !== undefined && args.isActive !== null) {
        const activeVal = args.isActive ? 'true' : 'false';
        filterFields.push(`<kar:Active>${activeVal}</kar:Active>`);
      }

      if (filterFields.length === 0) {
        return {
          content: [{ type: 'text', text: 'At least one search filter is required (e.g. query, firstName, lastName, mrn, dateOfBirth).' }],
        };
      }

      const bodyXml = `
        <kar:request>
          <kar:Fields>
            ${filterFields.join('\n            ')}
          </kar:Fields>
        </kar:request>`;

      const xml = await soapRequest(config, 'GetPatients', bodyXml);
      const patients = parsePatientList(xml);

      return {
        content: [
          {
            type: 'text',
            text: patients.length === 0
              ? 'No patients found matching the specified filters.'
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
