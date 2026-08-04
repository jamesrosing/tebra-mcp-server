/**
 * Tebra MCP tools: Payment retrieval and creation.
 *
 * GetPayments follows the standard list-GET shape (empty Fields + Filter in
 * WSDL PaymentFilter sequence order — see filter-helpers.ts).
 *
 * CreatePayment uses the WSDL PaymentCreate shape: nested Patient / Payment /
 * Appointment / Practice groups in sequence order (AjudicationDate,
 * Appointment, BatchNumber, Insurance, Other, Patient, PayerType, Payment,
 * PostDate, Practice). The amount and method live inside the nested
 * <Payment> group (AmountPaid → PaymentMethod → ReferenceNumber).
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';
import {
  buildListGetBody,
  rejectUnsupportedFilterArg,
  type FilterSequence,
} from './filter-helpers.js';

// ─── WSDL Sequence Table (source of truth: ?xsd=xsd0 PaymentFilter) ──

const PAYMENT_FILTER_SEQUENCE: FilterSequence = [
  ['amount', 'Amount'],
  ['appointmentId', 'AppointmentID'],
  ['batchNumber', 'BatchNumber'],
  ['fromCreatedDate', 'FromCreatedDate'],
  ['fromLastModifiedDate', 'FromLastModifiedDate'],
  ['fromPostDate', 'FromPostDate'],
  ['paymentId', 'ID'],
  ['payerName', 'PayerName'],
  ['payerType', 'PayerType'],
  ['practiceName', 'PracticeName'],
  ['referenceNumber', 'ReferenceNumber'],
  ['toCreatedDate', 'ToCreatedDate'],
  ['toLastModifiedDate', 'ToLastModifiedDate'],
  ['toPostDate', 'ToPostDate'],
];

// ─── Request Body Builders (exported for tests) ─────────────────

export function buildGetPaymentsBody(args: Record<string, unknown>): string {
  rejectUnsupportedFilterArg(
    args, 'patientId', 'tebra_get_payments',
    'is not a PaymentFilter member in the Tebra WSDL; filter by payerName, ' +
    'appointmentId, or a post-date range, or use tebra_get_transactions for patient-level activity.'
  );
  return buildListGetBody(PAYMENT_FILTER_SEQUENCE, args);
}

export function buildCreatePaymentBody(args: Record<string, unknown>): string {
  const patientId = String(args.patientId ?? '');
  const amount = args.amount != null ? Number(args.amount) : NaN;
  const paymentMethod = String(args.paymentMethod ?? '');

  const paymentDate = args.paymentDate ? String(args.paymentDate) : undefined;
  const referenceNumber = args.referenceNumber ? String(args.referenceNumber) : undefined;
  const appointmentId = args.appointmentId ? String(args.appointmentId) : undefined;
  const batchNumber = args.batchNumber ? String(args.batchNumber) : undefined;
  const practiceName = args.practiceName ? String(args.practiceName) : undefined;
  const payerType = args.payerType ? String(args.payerType) : 'Patient';

  // PaymentCreate WSDL sequence: AjudicationDate, Appointment, BatchNumber,
  // Insurance, Other, Patient, PayerType, Payment, PostDate, Practice.
  return `
        <kar:request>
          ${appointmentId ? `<kar:Appointment><kar:AppointmentID>${escapeXml(appointmentId)}</kar:AppointmentID></kar:Appointment>` : ''}
          ${batchNumber ? `<kar:BatchNumber>${escapeXml(batchNumber)}</kar:BatchNumber>` : ''}
          <kar:Patient>
            <kar:PatientID>${escapeXml(patientId)}</kar:PatientID>
          </kar:Patient>
          <kar:PayerType>${escapeXml(payerType)}</kar:PayerType>
          <kar:Payment>
            <kar:AmountPaid>${amount}</kar:AmountPaid>
            <kar:PaymentMethod>${escapeXml(paymentMethod)}</kar:PaymentMethod>
            ${referenceNumber ? `<kar:ReferenceNumber>${escapeXml(referenceNumber)}</kar:ReferenceNumber>` : ''}
          </kar:Payment>
          ${paymentDate ? `<kar:PostDate>${escapeXml(paymentDate)}</kar:PostDate>` : ''}
          ${practiceName ? `<kar:Practice><kar:PracticeName>${escapeXml(practiceName)}</kar:PracticeName></kar:Practice>` : ''}
        </kar:request>`;
}

// ─── Tool Definitions ───────────────────────────────────────────

export const paymentTools = [
  {
    name: 'tebra_get_payments',
    description:
      'Get payments from Tebra with optional post-date range, payer, batch, appointment, and reference-number filters. Returns payment details with amounts, methods, and payer info. Note: the Tebra WSDL has no patient ID filter for payments.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fromPostDate: {
          type: 'string',
          description: 'Optional start post date filter (ISO 8601)',
        },
        toPostDate: {
          type: 'string',
          description: 'Optional end post date filter (ISO 8601)',
        },
        payerName: {
          type: 'string',
          description: 'Optional payer name filter',
        },
        payerType: {
          type: 'string',
          description: 'Optional payer type filter (e.g. Patient, Insurance)',
        },
        batchNumber: {
          type: 'string',
          description: 'Optional batch number filter',
        },
        referenceNumber: {
          type: 'string',
          description: 'Optional reference/check number filter',
        },
        appointmentId: {
          type: 'string',
          description: 'Optional appointment ID filter',
        },
        paymentId: {
          type: 'string',
          description: 'Optional payment ID lookup',
        },
        amount: {
          type: 'string',
          description: 'Optional exact amount filter',
        },
        practiceName: {
          type: 'string',
          description: 'Optional practice name filter',
        },
        fromCreatedDate: {
          type: 'string',
          description: 'Optional start created date filter (ISO 8601)',
        },
        toCreatedDate: {
          type: 'string',
          description: 'Optional end created date filter (ISO 8601)',
        },
        fromLastModifiedDate: {
          type: 'string',
          description: 'Optional start last-modified date filter (ISO 8601)',
        },
        toLastModifiedDate: {
          type: 'string',
          description: 'Optional end last-modified date filter (ISO 8601)',
        },
      },
      required: [],
    },
  },
  {
    name: 'tebra_create_payment',
    description:
      'Create a new patient payment in Tebra. Supports Cash, Check, CreditCard, ElectronicFundsTransfer, and Other payment methods. Optionally link to an appointment and practice.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra patient ID',
        },
        amount: {
          type: 'number',
          description: 'Payment amount in dollars (e.g. 150.00)',
        },
        paymentMethod: {
          type: 'string',
          description: 'Payment method: Cash, Check, CreditCard, ElectronicFundsTransfer, or Other',
          enum: ['Cash', 'Check', 'CreditCard', 'ElectronicFundsTransfer', 'Other'],
        },
        paymentDate: {
          type: 'string',
          description: 'Optional payment post date (ISO 8601, defaults to today server-side)',
        },
        referenceNumber: {
          type: 'string',
          description: 'Optional reference or check number',
        },
        appointmentId: {
          type: 'string',
          description: 'Optional appointment ID to link payment to',
        },
        batchNumber: {
          type: 'string',
          description: 'Optional batch number',
        },
        practiceName: {
          type: 'string',
          description: 'Optional practice name (recommended for multi-practice accounts)',
        },
        payerType: {
          type: 'string',
          description: "Optional payer type (defaults to 'Patient')",
        },
      },
      required: ['patientId', 'amount', 'paymentMethod'],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handlePaymentTool(
  name: string,
  args: Record<string, unknown>,
  config: TebraConfig
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'tebra_get_payments': {
      const bodyXml = buildGetPaymentsBody(args);
      const xml = await soapRequest(config, 'GetPayments', bodyXml);
      const blocks = extractAllTags(xml, 'PaymentData');

      const payments = blocks
        .map((block) => ({
          paymentId: extractTag(block, 'ID'),
          amount: extractTag(block, 'Amount'),
          applied: extractTag(block, 'Applied'),
          unapplied: extractTag(block, 'Unapplied'),
          adjustments: extractTag(block, 'Adjustments'),
          refunds: extractTag(block, 'Refunds'),
          payerType: extractTag(block, 'PayerType'),
          payerName: extractTag(block, 'PayerName'),
          paymentMethod: extractTag(block, 'PaymentMethod'),
          category: extractTag(block, 'Category'),
          referenceNumber: extractTag(block, 'ReferenceNumber'),
          postDate: extractTag(block, 'PostDate'),
          adjudicationDate: extractTag(block, 'AdjudicationDate'),
          batchNumber: extractTag(block, 'BatchNumber'),
          appointmentId: extractTag(block, 'AppointmentID'),
        }))
        // Drop the phantom placeholder block Tebra emits on empty result sets.
        .filter((payment) => payment.paymentId !== '');

      if (payments.length === 0) {
        return {
          content: [{ type: 'text', text: 'No payments found matching the specified filters.' }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(payments, null, 2) }],
      };
    }

    case 'tebra_create_payment': {
      const patientId = String(args.patientId ?? '');
      const amount = args.amount != null ? Number(args.amount) : NaN;
      const paymentMethod = String(args.paymentMethod ?? '');

      if (!patientId || isNaN(amount) || !paymentMethod) {
        throw new Error('patientId, amount, and paymentMethod are required.');
      }

      const validMethods = ['Cash', 'Check', 'CreditCard', 'ElectronicFundsTransfer', 'Other'];
      if (!validMethods.includes(paymentMethod)) {
        throw new Error(`Invalid paymentMethod "${paymentMethod}". Must be one of: ${validMethods.join(', ')}`);
      }

      const bodyXml = buildCreatePaymentBody(args);
      const xml = await soapRequest(config, 'CreatePayment', bodyXml);
      const paymentId = extractTag(xml, 'PaymentID');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            paymentId,
            amount,
            paymentMethod,
            message: 'Payment created successfully.',
          }, null, 2),
        }],
      };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown payment tool: ${name}` }] };
  }
}
