/**
 * Tebra MCP tools: Insurance eligibility checking.
 *
 * Note: Tebra SOAP API does not expose a direct real-time eligibility
 * endpoint. This tool approximates eligibility by checking the patient's
 * active insurance policies and authorization history.
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

export const eligibilityTools = [
  {
    name: 'tebra_check_insurance_eligibility',
    description:
      'Check insurance eligibility for a Tebra patient. Examines active insurance policies and authorization history. Note: this is an approximation based on on-file data, not a real-time payer eligibility check.',
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
    return { content: [{ type: 'text', text: 'patientId is required.' }] };
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

  const insuranceBlocks = extractAllTags(patientBlock, 'InsurancePolicyData');
  const caseBlocks = extractAllTags(patientBlock, 'CaseData');

  // Find primary insurance
  let primaryInsurance: { payerName: string; memberId: string } | null = null;
  for (const ins of insuranceBlocks) {
    const seq = extractNumber(ins, 'SequenceNumber');
    if (seq === 1 || insuranceBlocks.length === 1) {
      primaryInsurance = {
        payerName: extractTag(ins, 'PayerName') || extractTag(ins, 'CompanyName'),
        memberId: extractTag(ins, 'MemberNumber') || extractTag(ins, 'PolicyNumber'),
      };
      break;
    }
  }

  // Check if any authorizations exist (indicates auth-required payer)
  let hasActiveAuths = false;
  for (const caseBlock of caseBlocks) {
    const authBlocks = extractAllTags(caseBlock, 'AuthorizationData');
    if (authBlocks.length > 0) {
      hasActiveAuths = true;
      break;
    }
  }

  const result = {
    eligible: !!primaryInsurance,
    planName: primaryInsurance?.payerName ?? null,
    memberId: primaryInsurance?.memberId ?? null,
    authRequired: hasActiveAuths,
    insurancePoliciesOnFile: insuranceBlocks.length,
    note: primaryInsurance
      ? 'Eligibility based on on-file insurance data. Verify with payer for real-time status.'
      : 'No insurance policies on file. Patient may be self-pay.',
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
