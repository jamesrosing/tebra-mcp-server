/**
 * Tebra MCP tools: Patient authorization retrieval.
 *
 * Uses GetPatient (Filter-only request shape — see patients.ts) and walks
 * the WSDL nesting: Patient → Cases (PatientCaseData) → InsurancePolicies
 * (PatientInsurancePolicyData) → Authorizations
 * (PatientInsurancePolicyAuthorizationData).
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, extractTag, extractAllTags } from '../soap-client.js';
import { buildGetPatientBody, parseAuthorizationBlock } from './patients.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const authorizationTools = [
  {
    name: 'tebra_get_patient_authorizations',
    description:
      'Get all insurance authorizations for a Tebra patient across all cases and policies. Returns auth number, approved/used/remaining visits, start/end dates, computed status (active/exhausted/expired/pending), payer contact info, and an expiring-soon warning.',
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

export async function handleAuthorizationTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (name !== 'tebra_get_patient_authorizations') {
    return { content: [{ type: 'text', text: `Unknown authorization tool: ${name}` }] };
  }

  const patientId = String(args.patientId ?? '');
  if (!patientId) {
    throw new Error('patientId is required.');
  }

  const bodyXml = buildGetPatientBody({ patientId });
  const xml = await soapRequest(config, 'GetPatient', bodyXml);
  const patientBlock = extractTag(xml, 'Patient');

  if (!patientBlock || !extractTag(patientBlock, 'ID')) {
    return { content: [{ type: 'text', text: `Patient not found: ${patientId}` }] };
  }

  const authorizations: Array<Record<string, unknown>> = [];

  for (const caseBlock of extractAllTags(patientBlock, 'PatientCaseData')) {
    const caseName = extractTag(caseBlock, 'Name');
    for (const policyBlock of extractAllTags(caseBlock, 'PatientInsurancePolicyData')) {
      const planName = extractTag(policyBlock, 'PlanName');
      const companyName = extractTag(policyBlock, 'CompanyName');
      for (const authBlock of extractAllTags(policyBlock, 'PatientInsurancePolicyAuthorizationData')) {
        const auth = parseAuthorizationBlock(authBlock);

        // Flag authorizations expiring within 30 days.
        let expiringWarning: string | undefined;
        if (auth.status === 'active' && auth.endDate) {
          const daysUntilExpiry = Math.ceil(
            (new Date(auth.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          );
          if (daysUntilExpiry <= 30 && daysUntilExpiry > 0) {
            expiringWarning = `Authorization expires in ${daysUntilExpiry} days`;
          }
        }

        authorizations.push({
          caseName,
          insuranceCompany: companyName,
          insurancePlan: planName,
          ...auth,
          ...(expiringWarning ? { expiringWarning } : {}),
        });
      }
    }
  }

  if (authorizations.length === 0) {
    return {
      content: [{ type: 'text', text: `No authorizations found for patient ${patientId}.` }],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(authorizations, null, 2) }],
  };
}
