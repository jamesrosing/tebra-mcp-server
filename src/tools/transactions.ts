/**
 * Tebra MCP tools: Transaction retrieval.
 *
 * Criteria go in <kar:Filter> in WSDL TransactionFilter sequence order —
 * see filter-helpers.ts. Note the WSDL member for transaction type is
 * `Type`, not `TransactionType`.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, extractTag, extractAllTags } from '../soap-client.js';
import { buildListGetBody, type FilterSequence } from './filter-helpers.js';

// ─── WSDL Sequence Table (source of truth: ?xsd=xsd0 TransactionFilter) ──

const TRANSACTION_FILTER_SEQUENCE: FilterSequence = [
  ['fromLastModifiedDate', 'FromLastModifiedDate'],
  ['fromPostingDate', 'FromPostingDate'],
  ['fromServiceDate', 'FromServiceDate'],
  ['fromTransactionDate', 'FromTransactionDate'],
  ['insuranceOrder', 'InsuranceOrder'],
  ['payerType', 'PayerType'],
  ['practiceName', 'PracticeName'],
  ['procedureCode', 'ProcedureCode'],
  ['toLastModifiedDate', 'ToLastModifiedDate'],
  ['toPostingDate', 'ToPostingDate'],
  ['toServiceDate', 'ToServiceDate'],
  ['toTransactionDate', 'ToTransactionDate'],
  ['transactionType', 'Type'],
];

// ─── Request Body Builder (exported for tests) ──────────────────

export function buildGetTransactionsBody(args: Record<string, unknown>): string {
  return buildListGetBody(TRANSACTION_FILTER_SEQUENCE, args);
}

// ─── Tool Definitions ───────────────────────────────────────────

export const transactionTools = [
  {
    name: 'tebra_get_transactions',
    description:
      'Get financial transactions from Tebra with optional date range, type, payer, procedure code, and practice filters. Returns transaction details with patient, claim, and insurance info.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fromServiceDate: {
          type: 'string',
          description: 'Optional start service date filter (ISO 8601)',
        },
        toServiceDate: {
          type: 'string',
          description: 'Optional end service date filter (ISO 8601)',
        },
        fromPostingDate: {
          type: 'string',
          description: 'Optional start posting date filter (ISO 8601)',
        },
        toPostingDate: {
          type: 'string',
          description: 'Optional end posting date filter (ISO 8601)',
        },
        fromTransactionDate: {
          type: 'string',
          description: 'Optional start transaction date filter (ISO 8601)',
        },
        toTransactionDate: {
          type: 'string',
          description: 'Optional end transaction date filter (ISO 8601)',
        },
        fromLastModifiedDate: {
          type: 'string',
          description: 'Optional start last-modified date filter (ISO 8601)',
        },
        toLastModifiedDate: {
          type: 'string',
          description: 'Optional end last-modified date filter (ISO 8601)',
        },
        transactionType: {
          type: 'string',
          description: 'Optional transaction type filter (sent as WSDL Type member)',
        },
        payerType: {
          type: 'string',
          description: 'Optional payer type filter',
        },
        insuranceOrder: {
          type: 'string',
          description: 'Optional insurance order filter (e.g. Primary, Secondary)',
        },
        procedureCode: {
          type: 'string',
          description: 'Optional CPT/procedure code filter',
        },
        practiceName: {
          type: 'string',
          description: 'Optional practice name filter',
        },
      },
      required: [],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleTransactionTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (name !== 'tebra_get_transactions') {
    return { content: [{ type: 'text', text: `Unknown transaction tool: ${name}` }] };
  }

  const bodyXml = buildGetTransactionsBody(args);
  const xml = await soapRequest(config, 'GetTransactions', bodyXml);
  const blocks = extractAllTags(xml, 'TransactionData');

  const transactions = blocks
    .map((block) => ({
      transactionId: extractTag(block, 'ID'),
      amount: extractTag(block, 'Amount'),
      type: extractTag(block, 'Type'),
      description: extractTag(block, 'Description'),
      patientId: extractTag(block, 'PatientID'),
      patientFullName: extractTag(block, 'PatientFullName'),
      claimId: extractTag(block, 'ClaimID'),
      procedureCode: extractTag(block, 'ProcedureCode'),
      payerType: extractTag(block, 'PayerType'),
      insuranceCompanyName: extractTag(block, 'InsuranceCompanyName'),
      insurancePlanName: extractTag(block, 'InsurancePlanName'),
      insuranceOrder: extractTag(block, 'InsuranceOrder'),
      practiceName: extractTag(block, 'PracticeName'),
      serviceDate: extractTag(block, 'ServiceDate'),
      postingDate: extractTag(block, 'PostingDate'),
      transactionDate: extractTag(block, 'TransactionDate'),
    }))
    // Drop the phantom placeholder block Tebra emits on empty result sets.
    .filter((txn) => txn.transactionId !== '');

  if (transactions.length === 0) {
    return {
      content: [{ type: 'text', text: 'No transactions found matching the specified filters.' }],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(transactions, null, 2) }],
  };
}
