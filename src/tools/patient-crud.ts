/**
 * Tebra MCP tools: Patient create and update.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

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

export const patientCrudTools = [
  {
    name: 'tebra_create_patient',
    description:
      'Create a new patient in Tebra with demographics, address, insurance, and guarantor information.',
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
        gender: {
          type: 'string',
          description: 'Optional gender (Male, Female, Other)',
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
        ssn: {
          type: 'string',
          description: 'Optional SSN (will be transmitted securely)',
        },
        referralSource: {
          type: 'string',
          description: 'Optional referral source',
        },
        primaryInsurance: {
          type: 'object',
          description: 'Optional primary insurance information',
          properties: {
            companyName: { type: 'string', description: 'Insurance company name' },
            memberId: { type: 'string', description: 'Member/subscriber ID' },
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
            relationship: { type: 'string', description: 'Optional relationship to patient' },
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
      'Update an existing patient in Tebra. Only provided fields will be changed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra patient ID to update',
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
        return {
          content: [{ type: 'text', text: 'firstName, lastName, and dateOfBirth are required.' }],
        };
      }

      const gender = args.gender ? String(args.gender) : undefined;
      const email = args.email ? String(args.email) : undefined;
      const homePhone = args.homePhone ? String(args.homePhone) : undefined;
      const mobilePhone = args.mobilePhone ? String(args.mobilePhone) : undefined;
      const address1 = args.address1 ? String(args.address1) : undefined;
      const address2 = args.address2 ? String(args.address2) : undefined;
      const city = args.city ? String(args.city) : undefined;
      const state = args.state ? String(args.state) : undefined;
      const zipCode = args.zipCode ? String(args.zipCode) : undefined;
      const ssn = args.ssn ? String(args.ssn) : undefined;
      const referralSource = args.referralSource ? String(args.referralSource) : undefined;
      const externalId = args.externalId ? String(args.externalId) : undefined;
      const primaryInsurance = args.primaryInsurance as InsuranceInput | undefined;
      const guarantor = args.guarantor as GuarantorInput | undefined;

      let insuranceXml = '';
      if (primaryInsurance) {
        insuranceXml = `
            <kar:InsurancePolicies>
              <kar:InsurancePolicyReq>
                <kar:CompanyName>${escapeXml(primaryInsurance.companyName)}</kar:CompanyName>
                <kar:MemberNumber>${escapeXml(primaryInsurance.memberId)}</kar:MemberNumber>
                ${primaryInsurance.groupNumber ? `<kar:GroupNumber>${escapeXml(primaryInsurance.groupNumber)}</kar:GroupNumber>` : ''}
                ${primaryInsurance.planName ? `<kar:PlanName>${escapeXml(primaryInsurance.planName)}</kar:PlanName>` : ''}
                <kar:SequenceNumber>1</kar:SequenceNumber>
              </kar:InsurancePolicyReq>
            </kar:InsurancePolicies>`;
      }

      let guarantorXml = '';
      if (guarantor) {
        guarantorXml = `
            <kar:Guarantor>
              <kar:FirstName>${escapeXml(guarantor.firstName)}</kar:FirstName>
              <kar:LastName>${escapeXml(guarantor.lastName)}</kar:LastName>
              ${guarantor.relationship ? `<kar:Relationship>${escapeXml(guarantor.relationship)}</kar:Relationship>` : ''}
            </kar:Guarantor>`;
      }

      const bodyXml = `
        <kar:request>
          <kar:Patient>
            <kar:FirstName>${escapeXml(firstName)}</kar:FirstName>
            <kar:LastName>${escapeXml(lastName)}</kar:LastName>
            <kar:DateofBirth>${escapeXml(dateOfBirth)}</kar:DateofBirth>
            ${gender ? `<kar:Gender>${escapeXml(gender)}</kar:Gender>` : ''}
            ${email ? `<kar:EmailAddress>${escapeXml(email)}</kar:EmailAddress>` : ''}
            ${homePhone ? `<kar:HomePhone>${escapeXml(homePhone)}</kar:HomePhone>` : ''}
            ${mobilePhone ? `<kar:MobilePhone>${escapeXml(mobilePhone)}</kar:MobilePhone>` : ''}
            ${address1 ? `<kar:AddressLine1>${escapeXml(address1)}</kar:AddressLine1>` : ''}
            ${address2 ? `<kar:AddressLine2>${escapeXml(address2)}</kar:AddressLine2>` : ''}
            ${city ? `<kar:City>${escapeXml(city)}</kar:City>` : ''}
            ${state ? `<kar:State>${escapeXml(state)}</kar:State>` : ''}
            ${zipCode ? `<kar:ZipCode>${escapeXml(zipCode)}</kar:ZipCode>` : ''}
            ${ssn ? `<kar:SSN>${escapeXml(ssn)}</kar:SSN>` : ''}
            ${referralSource ? `<kar:ReferralSource>${escapeXml(referralSource)}</kar:ReferralSource>` : ''}
            ${externalId ? `<kar:ExternalID>${escapeXml(externalId)}</kar:ExternalID>` : ''}
            ${insuranceXml}
            ${guarantorXml}
          </kar:Patient>
        </kar:request>`;

      const xml = await soapRequest(config, 'CreatePatient', bodyXml);
      const patientId = extractTag(xml, 'PatientID') || extractTag(xml, 'ID');

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
        return { content: [{ type: 'text', text: 'patientId is required.' }] };
      }

      const firstName = args.firstName ? String(args.firstName) : undefined;
      const lastName = args.lastName ? String(args.lastName) : undefined;
      const dateOfBirth = args.dateOfBirth ? String(args.dateOfBirth) : undefined;
      const gender = args.gender ? String(args.gender) : undefined;
      const email = args.email ? String(args.email) : undefined;
      const homePhone = args.homePhone ? String(args.homePhone) : undefined;
      const mobilePhone = args.mobilePhone ? String(args.mobilePhone) : undefined;
      const address1 = args.address1 ? String(args.address1) : undefined;
      const address2 = args.address2 ? String(args.address2) : undefined;
      const city = args.city ? String(args.city) : undefined;
      const state = args.state ? String(args.state) : undefined;
      const zipCode = args.zipCode ? String(args.zipCode) : undefined;

      const bodyXml = `
        <kar:request>
          <kar:Patient>
            <kar:PatientID>${escapeXml(patientId)}</kar:PatientID>
            ${firstName ? `<kar:FirstName>${escapeXml(firstName)}</kar:FirstName>` : ''}
            ${lastName ? `<kar:LastName>${escapeXml(lastName)}</kar:LastName>` : ''}
            ${dateOfBirth ? `<kar:DateofBirth>${escapeXml(dateOfBirth)}</kar:DateofBirth>` : ''}
            ${gender ? `<kar:Gender>${escapeXml(gender)}</kar:Gender>` : ''}
            ${email ? `<kar:EmailAddress>${escapeXml(email)}</kar:EmailAddress>` : ''}
            ${homePhone ? `<kar:HomePhone>${escapeXml(homePhone)}</kar:HomePhone>` : ''}
            ${mobilePhone ? `<kar:MobilePhone>${escapeXml(mobilePhone)}</kar:MobilePhone>` : ''}
            ${address1 ? `<kar:AddressLine1>${escapeXml(address1)}</kar:AddressLine1>` : ''}
            ${address2 ? `<kar:AddressLine2>${escapeXml(address2)}</kar:AddressLine2>` : ''}
            ${city ? `<kar:City>${escapeXml(city)}</kar:City>` : ''}
            ${state ? `<kar:State>${escapeXml(state)}</kar:State>` : ''}
            ${zipCode ? `<kar:ZipCode>${escapeXml(zipCode)}</kar:ZipCode>` : ''}
          </kar:Patient>
        </kar:request>`;

      const xml = await soapRequest(config, 'UpdatePatient', bodyXml);
      const updatedId = extractTag(xml, 'PatientID') || extractTag(xml, 'ID') || patientId;

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
