/**
 * Tebra MCP tools: Patient search and retrieval.
 *
 * GetPatients follows the standard list-GET shape (empty Fields + populated
 * Filter in WSDL sequence order — see filter-helpers.ts and CLAUDE.md quirks).
 *
 * GetPatient is different: per the WSDL, GetPatientReq has NO Fields member —
 * only Filter (SinglePatientFilter: ExternalID → ExternalVendorID → PatientID).
 * The pre-0.4.0 builds sent PatientID inside a Fields element that doesn't
 * exist in the schema, so single-patient lookup never resolved the ID.
 *
 * Response nesting (WSDL, xsd0):
 *   PatientData → Cases (PatientCaseData) → InsurancePolicies
 *   (PatientInsurancePolicyData) → Authorizations
 *   (PatientInsurancePolicyAuthorizationData)
 */

import type { TebraConfig } from '../config.js';
import {
  soapRequest,
  escapeXml,
  extractTag,
  extractAllTags,
  extractNumber,
} from '../soap-client.js';
import {
  buildListGetBody,
  rejectUnsupportedFilterArg,
  type FilterSequence,
} from './filter-helpers.js';

// ─── WSDL Sequence Table (source of truth: ?xsd=xsd0 PatientFilter) ──

const PATIENT_FILTER_SEQUENCE: FilterSequence = [
  ['firstName', 'FirstName'],
  ['fromCreatedDate', 'FromCreatedDate'],
  ['fromDateOfBirth', 'FromDateOfBirth'],
  ['fromLastEncounterDate', 'FromLastEncounterDate'],
  ['fromLastModifiedDate', 'FromLastModifiedDate'],
  ['fullName', 'FullName'],
  ['gender', 'Gender'],
  ['isActive', 'IsActive'],
  ['lastName', 'LastName'],
  ['practiceName', 'PracticeName'],
  ['insuranceCompanyName', 'PrimaryInsurancePolicyCompanyName'],
  ['referringProviderName', 'ReferringProviderFullName'],
  ['toCreatedDate', 'ToCreatedDate'],
  ['toDateOfBirth', 'ToDateOfBirth'],
  ['toLastEncounterDate', 'ToLastEncounterDate'],
  ['toLastModifiedDate', 'ToLastModifiedDate'],
];

// ─── Request Body Builders (exported for tests) ─────────────────

export function buildSearchPatientsBody(args: Record<string, unknown>): string {
  // PatientFilter has no MRN or ExternalID member — fail closed rather than
  // silently returning every patient in the practice.
  rejectUnsupportedFilterArg(
    args, 'mrn', 'tebra_search_patients',
    'is not a PatientFilter member in the Tebra WSDL; search by name/DOB and ' +
    "check 'mrn' in the results, or use tebra_get_patient if you have the patient ID."
  );
  rejectUnsupportedFilterArg(
    args, 'externalId', 'tebra_search_patients',
    "is not a PatientFilter member; use tebra_get_patient with 'externalId' instead."
  );

  const normalized: Record<string, unknown> = { ...args };
  // 'query' is the backward-compatible alias for fullName.
  if (normalized.fullName === undefined && normalized.query !== undefined) {
    normalized.fullName = normalized.query;
  }
  // Exact DOB maps to a single-day DOB range.
  if (normalized.dateOfBirth) {
    normalized.fromDateOfBirth ??= normalized.dateOfBirth;
    normalized.toDateOfBirth ??= normalized.dateOfBirth;
  }

  return buildListGetBody(PATIENT_FILTER_SEQUENCE, normalized);
}

export function buildGetPatientBody(args: Record<string, unknown>): string {
  const patientId = args.patientId !== undefined && args.patientId !== null && args.patientId !== ''
    ? String(args.patientId) : '';
  const externalId = args.externalId ? String(args.externalId) : '';
  const externalVendorId = args.externalVendorId !== undefined && args.externalVendorId !== null && args.externalVendorId !== ''
    ? String(args.externalVendorId) : '';

  if (!patientId && !externalId) {
    throw new Error('tebra_get_patient: patientId or externalId is required.');
  }
  if (patientId && !/^\d+$/.test(patientId)) {
    throw new Error(`tebra_get_patient: patientId must be numeric (got '${patientId}').`);
  }

  // GetPatientReq = { Filter: SinglePatientFilter } — no Fields element.
  // SinglePatientFilter sequence: ExternalID → ExternalVendorID → PatientID.
  const parts = [
    externalId ? `<kar:ExternalID>${escapeXml(externalId)}</kar:ExternalID>` : '',
    externalVendorId ? `<kar:ExternalVendorID>${escapeXml(externalVendorId)}</kar:ExternalVendorID>` : '',
    patientId ? `<kar:PatientID>${escapeXml(patientId)}</kar:PatientID>` : '',
  ].filter(Boolean);

  return `
    <kar:request>
      <kar:Filter>
        ${parts.join('\n        ')}
      </kar:Filter>
    </kar:request>`;
}

// ─── Tool Definitions ───────────────────────────────────────────

export const patientTools = [
  {
    name: 'tebra_search_patients',
    description:
      'Search for patients in Tebra with flexible filters. Use query/fullName for name search, or combine specific filters like firstName, lastName, DOB range, insurance company, practice, etc. Returns demographics, MRN, contact info, and primary/secondary insurance. Note: MRN and external ID are not server-side filters — use tebra_get_patient for external ID lookup.',
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
          description: 'Exact date of birth (YYYY-MM-DD); sent as a single-day DOB range',
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
          enum: ['Male', 'Female', 'Unknown'],
          description: 'Filter by gender (Tebra GenderCode: Male, Female, Unknown)',
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
          description: 'Primary insurance company name filter',
        },
        referringProviderName: {
          type: 'string',
          description: 'Referring provider full name filter',
        },
        fromLastEncounterDate: {
          type: 'string',
          description: 'Last-encounter date range start (YYYY-MM-DD)',
        },
        toLastEncounterDate: {
          type: 'string',
          description: 'Last-encounter date range end (YYYY-MM-DD)',
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
      'Get a full patient record from Tebra by patient ID, or by external system ID (optionally scoped to an external vendor). Includes demographics, contact info, cases, insurance policies, and authorizations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra patient ID (numeric)',
        },
        externalId: {
          type: 'string',
          description: 'External system ID (alternative to patientId)',
        },
        externalVendorId: {
          type: 'string',
          description: 'Optional external vendor ID to scope the externalId lookup',
        },
      },
      required: [],
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
      const hasAnyFilter = PATIENT_FILTER_SEQUENCE.some(
        ([key]) => args[key] !== undefined && args[key] !== null && args[key] !== ''
      ) || args.query || args.dateOfBirth;

      if (!hasAnyFilter) {
        throw new Error('At least one search filter is required (e.g. query, firstName, lastName, dateOfBirth). For a full patient list use tebra_get_all_patients.');
      }

      const bodyXml = buildSearchPatientsBody(args);
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
      const bodyXml = buildGetPatientBody(args);
      const xml = await soapRequest(config, 'GetPatient', bodyXml);
      const patientBlock = extractTag(xml, 'Patient');

      if (!patientBlock || !extractTag(patientBlock, 'ID')) {
        const requested = args.patientId ?? args.externalId;
        return {
          content: [{ type: 'text', text: `Patient not found: ${String(requested)}. If you don't have a Tebra patient ID, use tebra_search_patients with a name or DOB first.` }],
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

// ─── Parsers (exported for reuse by authorizations/eligibility) ──

export interface PatientResult {
  patientId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  mrn: string;
  active: string;
  mobilePhone: string;
  homePhone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  practiceName: string;
  primaryInsurance: { companyName: string; planName: string };
  secondaryInsurance: { companyName: string; planName: string };
  cases: Array<{
    caseId: string;
    caseName: string;
    payerScenario: string;
    isPrimaryCase: string;
    policies: Array<{
      companyName: string;
      planName: string;
      policyNumber: string;
      groupNumber: string;
      copay: string;
      deductible: string;
      effectiveStartDate: string;
      effectiveEndDate: string;
      authorizations: Array<{
        authNumber: string;
        approvedVisits: number;
        usedVisits: number;
        remainingVisits: number;
        startDate: string;
        endDate: string;
        status: string;
        contactFullName: string;
        contactPhone: string;
        notes: string;
      }>;
    }>;
  }>;
}

function parsePatientList(xml: string): PatientResult[] {
  const blocks = extractAllTags(xml, 'PatientData');
  // Drop the phantom placeholder block Tebra emits on empty result sets.
  return blocks.map(parsePatientBlock).filter((p) => p.patientId !== '');
}

export function parsePatientBlock(block: string): PatientResult {
  return {
    patientId: extractTag(block, 'ID'),
    firstName: extractTag(block, 'FirstName'),
    lastName: extractTag(block, 'LastName'),
    dateOfBirth: extractTag(block, 'DOB'),
    gender: extractTag(block, 'Gender'),
    mrn: extractTag(block, 'MedicalRecordNumber'),
    active: extractTag(block, 'Active'),
    mobilePhone: extractTag(block, 'MobilePhone'),
    homePhone: extractTag(block, 'HomePhone'),
    email: extractTag(block, 'EmailAddress'),
    address: extractTag(block, 'AddressLine1'),
    city: extractTag(block, 'City'),
    state: extractTag(block, 'State'),
    zipCode: extractTag(block, 'ZipCode'),
    practiceName: extractTag(block, 'PracticeName'),
    primaryInsurance: {
      companyName: extractTag(block, 'PrimaryInsurancePolicyCompanyName'),
      planName: extractTag(block, 'PrimaryInsurancePolicyPlanName'),
    },
    secondaryInsurance: {
      companyName: extractTag(block, 'SecondaryInsurancePolicyCompanyName'),
      planName: extractTag(block, 'SecondaryInsurancePolicyPlanName'),
    },
    cases: parseCases(block),
  };
}

export function parseCases(patientBlock: string): PatientResult['cases'] {
  return extractAllTags(patientBlock, 'PatientCaseData').map((caseBlock) => ({
    caseId: extractTag(caseBlock, 'PatientCaseID'),
    caseName: extractTag(caseBlock, 'Name'),
    payerScenario: extractTag(caseBlock, 'PayerScenario'),
    isPrimaryCase: extractTag(caseBlock, 'IsPrimaryCase'),
    policies: extractAllTags(caseBlock, 'PatientInsurancePolicyData').map((policy) => ({
      companyName: extractTag(policy, 'CompanyName'),
      planName: extractTag(policy, 'PlanName'),
      policyNumber: extractTag(policy, 'Number'),
      groupNumber: extractTag(policy, 'GroupNumber'),
      copay: extractTag(policy, 'Copay'),
      deductible: extractTag(policy, 'Deductible'),
      effectiveStartDate: extractTag(policy, 'EffectiveStartDate'),
      effectiveEndDate: extractTag(policy, 'EffectiveEndDate'),
      authorizations: extractAllTags(policy, 'PatientInsurancePolicyAuthorizationData').map(parseAuthorizationBlock),
    })),
  }));
}

export function parseAuthorizationBlock(authBlock: string): {
  authNumber: string;
  approvedVisits: number;
  usedVisits: number;
  remainingVisits: number;
  startDate: string;
  endDate: string;
  status: string;
  contactFullName: string;
  contactPhone: string;
  notes: string;
} {
  const approved = extractNumber(authBlock, 'AuthorizedNumberOfVisits');
  const used = extractNumber(authBlock, 'AuthorizedNumberOfVisitsUsed');
  return {
    authNumber: extractTag(authBlock, 'AuthorizationNumber'),
    approvedVisits: approved,
    usedVisits: used,
    remainingVisits: Math.max(0, approved - used),
    startDate: extractTag(authBlock, 'StartDate'),
    endDate: extractTag(authBlock, 'EndDate'),
    status: computeAuthStatus(authBlock, approved, used),
    contactFullName: extractTag(authBlock, 'ContactFullName'),
    contactPhone: extractTag(authBlock, 'ContactPhone'),
    notes: extractTag(authBlock, 'Notes'),
  };
}

function computeAuthStatus(block: string, approved: number, used: number): string {
  const remaining = approved - used;
  if (approved > 0 && remaining <= 0) return 'exhausted';
  const endDate = extractTag(block, 'EndDate');
  if (endDate && new Date(endDate) < new Date()) return 'expired';
  const authNumber = extractTag(block, 'AuthorizationNumber');
  if (!authNumber) return 'pending';
  return 'active';
}
