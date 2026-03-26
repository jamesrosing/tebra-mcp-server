/**
 * Tebra MCP tools: Patient authorization retrieval.
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

export const authorizationTools = [
  {
    name: 'tebra_get_patient_authorizations',
    description:
      'Get all authorizations for a Tebra patient across all cases. Returns auth number, approved/used/remaining visits, expiry dates, and covered CPT codes.',
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
    return { content: [{ type: 'text', text: `Patient not found: ${patientId}` }] };
  }

  const caseBlocks = extractAllTags(patientBlock, 'CaseData');
  const authorizations: AuthorizationResult[] = [];

  for (const caseBlock of caseBlocks) {
    const caseName = extractTag(caseBlock, 'CaseName') || extractTag(caseBlock, 'Name');
    const authBlocks = extractAllTags(caseBlock, 'AuthorizationData');

    for (const authBlock of authBlocks) {
      const approved = extractNumber(authBlock, 'ApprovedVisits');
      const used = extractNumber(authBlock, 'UsedVisits');
      const remaining = Math.max(0, approved - used);
      const endDate = extractTag(authBlock, 'EndDate');
      const authNumber = extractTag(authBlock, 'AuthorizationNumber');

      let status = 'active';
      if (remaining <= 0) status = 'exhausted';
      else if (endDate && new Date(endDate) < new Date()) status = 'expired';
      else if (!authNumber) status = 'pending';

      // Check if expiring within 30 days
      let expiringWarning: string | undefined;
      if (status === 'active' && endDate) {
        const daysUntilExpiry = Math.ceil(
          (new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        if (daysUntilExpiry <= 30 && daysUntilExpiry > 0) {
          expiringWarning = `Authorization expires in ${daysUntilExpiry} days`;
        }
      }

      const cptCodesRaw = extractTag(authBlock, 'CPTCodes') || extractTag(authBlock, 'ProcedureCodes');
      const diagCodesRaw = extractTag(authBlock, 'DiagnosisCodes');

      authorizations.push({
        caseName,
        authorizationId: extractTag(authBlock, 'AuthorizationID') || extractTag(authBlock, 'ID'),
        authNumber,
        insurancePlan: extractTag(authBlock, 'InsurancePlanName'),
        status,
        approvedVisits: approved,
        usedVisits: used,
        remainingVisits: remaining,
        startDate: extractTag(authBlock, 'StartDate'),
        endDate,
        approvedCptCodes: cptCodesRaw ? cptCodesRaw.split(',').map((c) => c.trim()).filter(Boolean) : [],
        diagnosisCodes: diagCodesRaw ? diagCodesRaw.split(',').map((c) => c.trim()).filter(Boolean) : [],
        notes: extractTag(authBlock, 'Notes'),
        expiringWarning,
      });
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

// ─── Types ──────────────────────────────────────────────────────

interface AuthorizationResult {
  caseName: string;
  authorizationId: string;
  authNumber: string;
  insurancePlan: string;
  status: string;
  approvedVisits: number;
  usedVisits: number;
  remainingVisits: number;
  startDate: string;
  endDate: string;
  approvedCptCodes: string[];
  diagnosisCodes: string[];
  notes: string;
  expiringWarning?: string;
}
