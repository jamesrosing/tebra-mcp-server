/**
 * Tebra MCP tools: Transaction retrieval.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const transactionTools = [
  {
    name: 'tebra_get_transactions',
    description:
      'Get transactions from Tebra with optional date range, type, and payer filters. Returns financial transaction details.',
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
        transactionType: {
          type: 'string',
          description: 'Optional transaction type filter',
        },
        payerType: {
          type: 'string',
          description: 'Optional payer type filter',
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

  const fromServiceDate = args.fromServiceDate ? String(args.fromServiceDate) : undefined;
  const toServiceDate = args.toServiceDate ? String(args.toServiceDate) : undefined;
  const fromPostingDate = args.fromPostingDate ? String(args.fromPostingDate) : undefined;
  const toPostingDate = args.toPostingDate ? String(args.toPostingDate) : undefined;
  const fromTransactionDate = args.fromTransactionDate ? String(args.fromTransactionDate) : undefined;
  const toTransactionDate = args.toTransactionDate ? String(args.toTransactionDate) : undefined;
  const transactionType = args.transactionType ? String(args.transactionType) : undefined;
  const payerType = args.payerType ? String(args.payerType) : undefined;
  const procedureCode = args.procedureCode ? String(args.procedureCode) : undefined;
  const practiceName = args.practiceName ? String(args.practiceName) : undefined;

  const fieldsXml = [
    fromServiceDate ? `<kar:FromServiceDate>${escapeXml(fromServiceDate)}</kar:FromServiceDate>` : '',
    toServiceDate ? `<kar:ToServiceDate>${escapeXml(toServiceDate)}</kar:ToServiceDate>` : '',
    fromPostingDate ? `<kar:FromPostingDate>${escapeXml(fromPostingDate)}</kar:FromPostingDate>` : '',
    toPostingDate ? `<kar:ToPostingDate>${escapeXml(toPostingDate)}</kar:ToPostingDate>` : '',
    fromTransactionDate ? `<kar:FromTransactionDate>${escapeXml(fromTransactionDate)}</kar:FromTransactionDate>` : '',
    toTransactionDate ? `<kar:ToTransactionDate>${escapeXml(toTransactionDate)}</kar:ToTransactionDate>` : '',
    transactionType ? `<kar:TransactionType>${escapeXml(transactionType)}</kar:TransactionType>` : '',
    payerType ? `<kar:PayerType>${escapeXml(payerType)}</kar:PayerType>` : '',
    procedureCode ? `<kar:ProcedureCode>${escapeXml(procedureCode)}</kar:ProcedureCode>` : '',
    practiceName ? `<kar:PracticeName>${escapeXml(practiceName)}</kar:PracticeName>` : '',
  ]
    .filter(Boolean)
    .join('\n        ');

  const bodyXml = `
    <kar:request>
      <kar:Fields>
        ${fieldsXml}
      </kar:Fields>
    </kar:request>`;

  const xml = await soapRequest(config, 'GetTransactions', bodyXml);
  const blocks = extractAllTags(xml, 'TransactionData');

  const transactions = blocks.map((block) => ({
    transactionId: extractTag(block, 'ID'),
    amount: extractTag(block, 'Amount'),
    type: extractTag(block, 'Type'),
    description: extractTag(block, 'Description'),
    patientId: extractTag(block, 'PatientID'),
    patientFullName: extractTag(block, 'PatientFullName'),
    claimId: extractTag(block, 'ClaimID'),
    procedureCode: extractTag(block, 'ProcedureCode'),
    insuranceCompanyName: extractTag(block, 'InsuranceCompanyName'),
    serviceDate: extractTag(block, 'ServiceDate'),
    postingDate: extractTag(block, 'PostingDate'),
    transactionDate: extractTag(block, 'TransactionDate'),
  }));

  if (transactions.length === 0) {
    return {
      content: [{ type: 'text', text: 'No transactions found matching the specified filters.' }],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(transactions, null, 2) }],
  };
}
