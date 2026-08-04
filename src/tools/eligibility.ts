/**
 * Tebra MCP tools: Insurance eligibility checking.
 *
 * Note: Tebra SOAP API does not expose a direct real-time eligibility
 * endpoint. This tool approximates eligibility by checking the patient's
 * on-file insurance policies and authorization history via GetPatient
 * (Filter-only request shape — see patients.ts).
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, extractTag, extractAllTags } from '../soap-client.js';
import { buildGetPatientBody } from './patients.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const eligibilityTools = [
  {
    name: 'tebra_check_insurance_eligibility',
    description:
      'Check insurance eligibility for a Tebra patient. Examines on-file insurance policies and authorization history. Note: this is an approximation based on on-file data, not a real-time payer eligibility check.',
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

export async function handleEligibilityTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (name !== 'tebra_check_insurance_eligibility') {
    return { content: [{ type: 'text', text: `Unknown eligibility tool: ${name}` }] };
  }

  const patientId = String(args.patientId ?? '');
  if (!patientId) {
    throw new Error('patientId is required.');
  }

  const bodyXml = buildGetPatientBody({ patientId });
  const xml = await soapRequest(config, 'GetPatient', bodyXml);
  const patientBlock = extractTag(xml, 'Patient');

  if (!patientBlock || !extractTag(patientBlock, 'ID')) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              eligible: false,
              reason: 'Patient not found in Tebra',
              authRequired: false,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Primary insurance from the flat PatientData projection.
  const primaryCompany = extractTag(patientBlock, 'PrimaryInsurancePolicyCompanyName');
  const primaryPlan = extractTag(patientBlock, 'PrimaryInsurancePolicyPlanName');
  const primaryNumber = extractTag(patientBlock, 'PrimaryInsurancePolicyNumber');

  // Count policies and check for any authorizations across cases.
  const policyBlocks = extractAllTags(patientBlock, 'PatientInsurancePolicyData');
  const hasActiveAuths = extractAllTags(patientBlock, 'PatientInsurancePolicyAuthorizationData').length > 0;

  const result = {
    eligible: !!primaryCompany,
    payerName: primaryCompany || null,
    planName: primaryPlan || null,
    memberId: primaryNumber || null,
    authRequired: hasActiveAuths,
    insurancePoliciesOnFile: policyBlocks.length,
    note: primaryCompany
      ? 'Eligibility based on on-file insurance data. Verify with payer for real-time status.'
      : 'No insurance policies on file. Patient may be self-pay.',
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
