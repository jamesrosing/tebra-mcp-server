/**
 * Tebra MCP tools: Patient create and update.
 *
 * PatientCreate/PatientUpdate are flat WSDL types whose members must be
 * emitted in <xs:sequence> order — WCF's DataContractSerializer silently
 * drops out-of-order members (the pre-0.4.0 build sent FirstName first,
 * which caused everything alphabetically before it — address, city, DOB —
 * to be dropped server-side). Key member names differ from the obvious:
 * SocialSecurityNumber (not SSN), PatientExternalID (not ExternalID),
 * MedicalRecordNumber. Insurance policies ride inside Cases → Policies,
 * and the guarantor relationship member is RelationshiptoGuarantor.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag } from '../soap-client.js';
import { resolveDefaultPracticeId } from './practices.js';

/** Fill in the required practice identifier when the caller omitted it. */
async function withPractice(
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<Record<string, unknown>> {
  if (args.practiceId || args.practiceName) return args;
  return { ...args, practiceId: await resolveDefaultPracticeId(config) };
}

interface InsuranceInput {
  companyName: string;
  memberId: string;
  groupNumber?: string;
  planName?: string;
}

interface GuarantorInput {
  firstName: string;
  lastName: string;
  relationship?: string;
}

const GUARANTOR_RELATIONSHIPS = ['Child', 'Other', 'Self', 'Spouse'];

// ─── Request Body Builders (exported for tests) ─────────────────

export function buildCreatePatientBody(args: Record<string, unknown>): string {
  const str = (key: string): string => (args[key] ? String(args[key]) : '');
  const primaryInsurance = args.primaryInsurance as InsuranceInput | undefined;
  const guarantor = args.guarantor as GuarantorInput | undefined;

  // Insurance policies must ride inside a patient case (Cases → Policies).
  let casesXml = '';
  if (primaryInsurance) {
    // InsurancePolicyCreateReq sequence: ..., CompanyName, ..., PlanName,
    // PolicyGroupNumber, ..., PolicyNumber, Precedence, ...
    casesXml = `
            <kar:Cases>
              <kar:PatientCaseCreateReq>
                <kar:Active>true</kar:Active>
                <kar:CaseName>Default Case</kar:CaseName>
                <kar:PayerScenario>Insurance</kar:PayerScenario>
                <kar:Policies>
                  <kar:InsurancePolicyCreateReq>
                    <kar:Active>true</kar:Active>
                    <kar:CompanyName>${escapeXml(primaryInsurance.companyName)}</kar:CompanyName>
                    ${primaryInsurance.planName ? `<kar:PlanName>${escapeXml(primaryInsurance.planName)}</kar:PlanName>` : ''}
                    ${primaryInsurance.groupNumber ? `<kar:PolicyGroupNumber>${escapeXml(primaryInsurance.groupNumber)}</kar:PolicyGroupNumber>` : ''}
                    <kar:PolicyNumber>${escapeXml(primaryInsurance.memberId)}</kar:PolicyNumber>
                    <kar:Precedence>1</kar:Precedence>
                  </kar:InsurancePolicyCreateReq>
                </kar:Policies>
              </kar:PatientCaseCreateReq>
            </kar:Cases>`;
  }

  let guarantorXml = '';
  if (guarantor) {
    const relationship = guarantor.relationship && GUARANTOR_RELATIONSHIPS.includes(guarantor.relationship)
      ? guarantor.relationship
      : 'Other';
    // PatientGuarantorReq sequence: ..., DifferentThanPatient, FirstName,
    // LastName, ..., RelationshiptoGuarantor, ...
    guarantorXml = `
            <kar:Guarantor>
              <kar:DifferentThanPatient>true</kar:DifferentThanPatient>
              <kar:FirstName>${escapeXml(guarantor.firstName)}</kar:FirstName>
              <kar:LastName>${escapeXml(guarantor.lastName)}</kar:LastName>
              <kar:RelationshiptoGuarantor>${escapeXml(relationship)}</kar:RelationshiptoGuarantor>
            </kar:Guarantor>`;
  }

  // Practice is a REQUIRED PatientCreate member (minOccurs=1; omitting it
  // faults with "Expecting element 'Practice'" — verified live 2026-08-04).
  // The handler auto-resolves practiceId before calling this builder.
  const practiceId = str('practiceId');
  const practiceName = str('practiceName');
  if (!practiceId && !practiceName) {
    throw new Error('tebra_create_patient: practiceId or practiceName is required (the WSDL Practice member is mandatory).');
  }
  const practiceXml = `<kar:Practice>
              ${practiceId ? `<kar:PracticeID>${escapeXml(practiceId)}</kar:PracticeID>` : ''}
              ${practiceName ? `<kar:PracticeName>${escapeXml(practiceName)}</kar:PracticeName>` : ''}
            </kar:Practice>`;

  // PatientCreate WSDL sequence order (members we emit).
  return `
        <kar:request>
          <kar:Patient>
            ${str('address1') ? `<kar:AddressLine1>${escapeXml(str('address1'))}</kar:AddressLine1>` : ''}
            ${str('address2') ? `<kar:AddressLine2>${escapeXml(str('address2'))}</kar:AddressLine2>` : ''}
            ${casesXml}
            ${str('city') ? `<kar:City>${escapeXml(str('city'))}</kar:City>` : ''}
            <kar:DateofBirth>${escapeXml(str('dateOfBirth'))}</kar:DateofBirth>
            ${str('email') ? `<kar:EmailAddress>${escapeXml(str('email'))}</kar:EmailAddress>` : ''}
            <kar:FirstName>${escapeXml(str('firstName'))}</kar:FirstName>
            ${str('gender') ? `<kar:Gender>${escapeXml(str('gender'))}</kar:Gender>` : ''}
            ${guarantorXml}
            ${str('homePhone') ? `<kar:HomePhone>${escapeXml(str('homePhone'))}</kar:HomePhone>` : ''}
            <kar:LastName>${escapeXml(str('lastName'))}</kar:LastName>
            ${str('mrn') ? `<kar:MedicalRecordNumber>${escapeXml(str('mrn'))}</kar:MedicalRecordNumber>` : ''}
            ${str('mobilePhone') ? `<kar:MobilePhone>${escapeXml(str('mobilePhone'))}</kar:MobilePhone>` : ''}
            ${str('externalId') ? `<kar:PatientExternalID>${escapeXml(str('externalId'))}</kar:PatientExternalID>` : ''}
            ${practiceXml}
            ${str('referralSource') ? `<kar:ReferralSource>${escapeXml(str('referralSource'))}</kar:ReferralSource>` : ''}
            ${str('ssn') ? `<kar:SocialSecurityNumber>${escapeXml(str('ssn'))}</kar:SocialSecurityNumber>` : ''}
            ${str('state') ? `<kar:State>${escapeXml(str('state'))}</kar:State>` : ''}
            ${str('zipCode') ? `<kar:ZipCode>${escapeXml(str('zipCode'))}</kar:ZipCode>` : ''}
          </kar:Patient>
        </kar:request>`;
}

export function buildUpdatePatientBody(args: Record<string, unknown>): string {
  const str = (key: string): string => (args[key] ? String(args[key]) : '');

  // Practice is a REQUIRED PatientUpdate member — same as PatientCreate.
  // The handler auto-resolves practiceId before calling this builder.
  const practiceId = str('practiceId');
  const practiceName = str('practiceName');
  if (!practiceId && !practiceName) {
    throw new Error('tebra_update_patient: practiceId or practiceName is required (the WSDL Practice member is mandatory).');
  }

  // PatientUpdate WSDL sequence order (members we emit). PatientID sits
  // between PatientExternalID and Practice in the sequence.
  return `
        <kar:request>
          <kar:Patient>
            ${str('address1') ? `<kar:AddressLine1>${escapeXml(str('address1'))}</kar:AddressLine1>` : ''}
            ${str('address2') ? `<kar:AddressLine2>${escapeXml(str('address2'))}</kar:AddressLine2>` : ''}
            ${str('city') ? `<kar:City>${escapeXml(str('city'))}</kar:City>` : ''}
            ${str('dateOfBirth') ? `<kar:DateofBirth>${escapeXml(str('dateOfBirth'))}</kar:DateofBirth>` : ''}
            ${str('email') ? `<kar:EmailAddress>${escapeXml(str('email'))}</kar:EmailAddress>` : ''}
            ${str('firstName') ? `<kar:FirstName>${escapeXml(str('firstName'))}</kar:FirstName>` : ''}
            ${str('gender') ? `<kar:Gender>${escapeXml(str('gender'))}</kar:Gender>` : ''}
            ${str('homePhone') ? `<kar:HomePhone>${escapeXml(str('homePhone'))}</kar:HomePhone>` : ''}
            ${str('lastName') ? `<kar:LastName>${escapeXml(str('lastName'))}</kar:LastName>` : ''}
            ${str('mobilePhone') ? `<kar:MobilePhone>${escapeXml(str('mobilePhone'))}</kar:MobilePhone>` : ''}
            <kar:PatientID>${escapeXml(str('patientId'))}</kar:PatientID>
            <kar:Practice>
              ${practiceId ? `<kar:PracticeID>${escapeXml(practiceId)}</kar:PracticeID>` : ''}
              ${practiceName ? `<kar:PracticeName>${escapeXml(practiceName)}</kar:PracticeName>` : ''}
            </kar:Practice>
            ${str('state') ? `<kar:State>${escapeXml(str('state'))}</kar:State>` : ''}
            ${str('zipCode') ? `<kar:ZipCode>${escapeXml(str('zipCode'))}</kar:ZipCode>` : ''}
          </kar:Patient>
        </kar:request>`;
}

// ─── Tool Definitions ───────────────────────────────────────────

export const patientCrudTools = [
  {
    name: 'tebra_create_patient',
    description:
      "Create a new patient in Tebra with demographics, address, insurance, and guarantor information. The practice is required by Tebra; if practiceName/practiceId are omitted, the account's first practice is used automatically.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        firstName: {
          type: 'string',
          description: 'Patient first name',
        },
        lastName: {
          type: 'string',
          description: 'Patient last name',
        },
        dateOfBirth: {
          type: 'string',
          description: 'Date of birth (ISO 8601, e.g. 1990-01-15)',
        },
        practiceName: {
          type: 'string',
          description: "Practice name (auto-resolved to the account's first practice if omitted)",
        },
        practiceId: {
          type: 'string',
          description: 'Practice ID (alternative to practiceName)',
        },
        gender: {
          type: 'string',
          enum: ['Male', 'Female', 'Unknown'],
          description: 'Optional gender (Tebra GenderCode: Male, Female, Unknown)',
        },
        email: {
          type: 'string',
          description: 'Optional email address',
        },
        homePhone: {
          type: 'string',
          description: 'Optional home phone number',
        },
        mobilePhone: {
          type: 'string',
          description: 'Optional mobile phone number',
        },
        address1: {
          type: 'string',
          description: 'Optional street address line 1',
        },
        address2: {
          type: 'string',
          description: 'Optional street address line 2',
        },
        city: {
          type: 'string',
          description: 'Optional city',
        },
        state: {
          type: 'string',
          description: 'Optional state (2-letter abbreviation)',
        },
        zipCode: {
          type: 'string',
          description: 'Optional ZIP code',
        },
        mrn: {
          type: 'string',
          description: 'Optional medical record number',
        },
        ssn: {
          type: 'string',
          description: 'Optional SSN',
        },
        referralSource: {
          type: 'string',
          description: 'Optional referral source',
        },
        primaryInsurance: {
          type: 'object',
          description: 'Optional primary insurance (created inside a default patient case)',
          properties: {
            companyName: { type: 'string', description: 'Insurance company name' },
            memberId: { type: 'string', description: 'Member/policy number' },
            groupNumber: { type: 'string', description: 'Optional group number' },
            planName: { type: 'string', description: 'Optional plan name' },
          },
          required: ['companyName', 'memberId'],
        },
        guarantor: {
          type: 'object',
          description: 'Optional guarantor information',
          properties: {
            firstName: { type: 'string', description: 'Guarantor first name' },
            lastName: { type: 'string', description: 'Guarantor last name' },
            relationship: {
              type: 'string',
              enum: GUARANTOR_RELATIONSHIPS,
              description: 'Patient relationship to guarantor (default Other)',
            },
          },
          required: ['firstName', 'lastName'],
        },
        externalId: {
          type: 'string',
          description: 'Optional external system ID',
        },
      },
      required: ['firstName', 'lastName', 'dateOfBirth'],
    },
  },
  {
    name: 'tebra_update_patient',
    description:
      "Update an existing patient in Tebra. Only provided fields will be changed. The practice is required by Tebra; if practiceName/practiceId are omitted, the account's first practice is used automatically.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra patient ID to update',
        },
        practiceName: {
          type: 'string',
          description: "Practice name (auto-resolved to the account's first practice if omitted)",
        },
        practiceId: {
          type: 'string',
          description: 'Practice ID (alternative to practiceName)',
        },
        firstName: {
          type: 'string',
          description: 'Optional updated first name',
        },
        lastName: {
          type: 'string',
          description: 'Optional updated last name',
        },
        dateOfBirth: {
          type: 'string',
          description: 'Optional updated date of birth (ISO 8601)',
        },
        gender: {
          type: 'string',
          enum: ['Male', 'Female', 'Unknown'],
          description: 'Optional updated gender',
        },
        email: {
          type: 'string',
          description: 'Optional updated email address',
        },
        homePhone: {
          type: 'string',
          description: 'Optional updated home phone number',
        },
        mobilePhone: {
          type: 'string',
          description: 'Optional updated mobile phone number',
        },
        address1: {
          type: 'string',
          description: 'Optional updated street address line 1',
        },
        address2: {
          type: 'string',
          description: 'Optional updated street address line 2',
        },
        city: {
          type: 'string',
          description: 'Optional updated city',
        },
        state: {
          type: 'string',
          description: 'Optional updated state',
        },
        zipCode: {
          type: 'string',
          description: 'Optional updated ZIP code',
        },
      },
      required: ['patientId'],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handlePatientCrudTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'tebra_create_patient': {
      const firstName = String(args.firstName ?? '');
      const lastName = String(args.lastName ?? '');
      const dateOfBirth = String(args.dateOfBirth ?? '');

      if (!firstName || !lastName || !dateOfBirth) {
        throw new Error('firstName, lastName, and dateOfBirth are required.');
      }

      const bodyXml = buildCreatePatientBody(await withPractice(args, config));
      const xml = await soapRequest(config, 'CreatePatient', bodyXml);
      const patientId = extractTag(xml, 'PatientID');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            patientId,
            message: 'Patient created successfully.',
          }, null, 2),
        }],
      };
    }

    case 'tebra_update_patient': {
      const patientId = String(args.patientId ?? '');
      if (!patientId) {
        throw new Error('patientId is required.');
      }

      const bodyXml = buildUpdatePatientBody(await withPractice(args, config));
      const xml = await soapRequest(config, 'UpdatePatient', bodyXml);
      const updatedId = extractTag(xml, 'PatientID') || patientId;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            patientId: updatedId,
            message: 'Patient updated successfully.',
          }, null, 2),
        }],
      };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown patient CRUD tool: ${name}` }] };
  }
}
