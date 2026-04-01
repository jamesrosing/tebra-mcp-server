/**
 * Tebra MCP tools: Payment retrieval and creation.
 */

import type { TebraConfig } from '../config.js';
import { soapRequest, escapeXml, extractTag, extractAllTags } from '../soap-client.js';

// ─── Tool Definitions ───────────────────────────────────────────

export const paymentTools = [
  {
    name: 'tebra_get_payments',
    description:
      'Get payments from Tebra with optional date range and patient filters. Returns payment details with amounts, methods, and payer info.',
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
        patientId: {
          type: 'string',
          description: 'Optional Tebra patient ID filter',
        },
        payerName: {
          type: 'string',
          description: 'Optional payer name filter',
        },
        batchNumber: {
          type: 'string',
          description: 'Optional batch number filter',
        },
        referenceNumber: {
          type: 'string',
          description: 'Optional reference/check number filter',
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
      'Create a new payment in Tebra for a patient. Supports Cash, Check, CreditCard, ElectronicFundsTransfer, and Other payment methods.',
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
          description: 'Optional payment date (ISO 8601, defaults to today)',
        },
        referenceNumber: {
          type: 'string',
          description: 'Optional reference or check number',
        },
        notes: {
          type: 'string',
          description: 'Optional payment notes',
        },
        appointmentId: {
          type: 'string',
          description: 'Optional appointment ID to link payment to',
        },
        batchNumber: {
          type: 'string',
          description: 'Optional batch number',
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
      const fromPostDate = args.fromPostDate ? String(args.fromPostDate) : undefined;
      const toPostDate = args.toPostDate ? String(args.toPostDate) : undefined;
      const patientId = args.patientId ? String(args.patientId) : undefined;
      const payerName = args.payerName ? String(args.payerName) : undefined;
      const batchNumber = args.batchNumber ? String(args.batchNumber) : undefined;
      const referenceNumber = args.referenceNumber ? String(args.referenceNumber) : undefined;
      const fromLastModifiedDate = args.fromLastModifiedDate ? String(args.fromLastModifiedDate) : undefined;
      const toLastModifiedDate = args.toLastModifiedDate ? String(args.toLastModifiedDate) : undefined;

      const fieldsXml = [
        fromPostDate ? `<kar:FromPostDate>${escapeXml(fromPostDate)}</kar:FromPostDate>` : '',
        toPostDate ? `<kar:ToPostDate>${escapeXml(toPostDate)}</kar:ToPostDate>` : '',
        patientId ? `<kar:PatientID>${escapeXml(patientId)}</kar:PatientID>` : '',
        payerName ? `<kar:PayerName>${escapeXml(payerName)}</kar:PayerName>` : '',
        batchNumber ? `<kar:BatchNumber>${escapeXml(batchNumber)}</kar:BatchNumber>` : '',
        referenceNumber ? `<kar:ReferenceNumber>${escapeXml(referenceNumber)}</kar:ReferenceNumber>` : '',
        fromLastModifiedDate ? `<kar:FromLastModifiedDate>${escapeXml(fromLastModifiedDate)}</kar:FromLastModifiedDate>` : '',
        toLastModifiedDate ? `<kar:ToLastModifiedDate>${escapeXml(toLastModifiedDate)}</kar:ToLastModifiedDate>` : '',
      ]
        .filter(Boolean)
        .join('\n        ');

      const bodyXml = `
        <kar:request>
          <kar:Fields>
            ${fieldsXml}
          </kar:Fields>
        </kar:request>`;

      const xml = await soapRequest(config, 'GetPayments', bodyXml);
      const blocks = extractAllTags(xml, 'PaymentData');

      const payments = blocks.map((block) => ({
        paymentId: extractTag(block, 'ID'),
        amount: extractTag(block, 'Amount'),
        applied: extractTag(block, 'Applied'),
        unapplied: extractTag(block, 'Unapplied'),
        adjustments: extractTag(block, 'Adjustments'),
        refunds: extractTag(block, 'Refunds'),
        payerType: extractTag(block, 'PayerType'),
        payerName: extractTag(block, 'PayerName'),
        paymentMethod: extractTag(block, 'PaymentMethod'),
        referenceNumber: extractTag(block, 'ReferenceNumber'),
        postDate: extractTag(block, 'PostDate'),
        batchNumber: extractTag(block, 'BatchNumber'),
        appointmentId: extractTag(block, 'AppointmentID'),
      }));

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
        return {
          content: [{ type: 'text', text: 'patientId, amount, and paymentMethod are required.' }],
        };
      }

      const validMethods = ['Cash', 'Check', 'CreditCard', 'ElectronicFundsTransfer', 'Other'];
      if (!validMethods.includes(paymentMethod)) {
        return {
          content: [{ type: 'text', text: `Invalid paymentMethod "${paymentMethod}". Must be one of: ${validMethods.join(', ')}` }],
        };
      }

      const paymentDate = args.paymentDate ? String(args.paymentDate) : undefined;
      const referenceNumber = args.referenceNumber ? String(args.referenceNumber) : undefined;
      const notes = args.notes ? String(args.notes) : undefined;
      const appointmentId = args.appointmentId ? String(args.appointmentId) : undefined;
      const batchNumber = args.batchNumber ? String(args.batchNumber) : undefined;

      const bodyXml = `
        <kar:request>
          <kar:Payment>
            <kar:Patient>
              <kar:PatientID>${escapeXml(patientId)}</kar:PatientID>
            </kar:Patient>
            <kar:AmountPaid>${amount}</kar:AmountPaid>
            <kar:PaymentMethod>${escapeXml(paymentMethod)}</kar:PaymentMethod>
            ${paymentDate ? `<kar:PostDate>${escapeXml(paymentDate)}</kar:PostDate>` : ''}
            ${referenceNumber ? `<kar:ReferenceNumber>${escapeXml(referenceNumber)}</kar:ReferenceNumber>` : ''}
            ${notes ? `<kar:Notes>${escapeXml(notes)}</kar:Notes>` : ''}
            ${appointmentId ? `<kar:AppointmentID>${escapeXml(appointmentId)}</kar:AppointmentID>` : ''}
            ${batchNumber ? `<kar:BatchNumber>${escapeXml(batchNumber)}</kar:BatchNumber>` : ''}
          </kar:Payment>
        </kar:request>`;

      const xml = await soapRequest(config, 'CreatePayment', bodyXml);
      const paymentId = extractTag(xml, 'PaymentID') || extractTag(xml, 'ID');

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
