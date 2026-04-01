/**
 * Tebra MCP Integration Service for FAL (allure-md.com)
 *
 * Wraps Tebra MCP tool calls for FAL use cases:
 * - Syncing new patients from allure-md.com registration to Tebra
 * - Posting payments to Tebra after Stripe payment succeeds
 * - Linking Supabase client IDs to Tebra patient IDs
 *
 * DEPLOYMENT: Copy this file to your FAL project:
 *   /src/lib/services/tebra-integration.ts
 *   (or wherever services live in the FAL project)
 *
 * This module communicates with the Tebra MCP server via an McpToolCaller
 * interface. Wire it to @modelcontextprotocol/sdk/client or any MCP-compatible
 * transport.
 */

// ─── MCP Tool Name Constants ────────────────────────────────────

const TOOL = {
  CREATE_PATIENT: 'tebra_create_patient',
  SEARCH_PATIENTS: 'tebra_search_patients',
  UPDATE_PATIENT: 'tebra_update_patient',
  UPDATE_PATIENT_EXTERNAL_ID: 'tebra_update_patient_external_id',
  CREATE_PAYMENT: 'tebra_create_payment',
  GET_PROVIDERS: 'tebra_get_providers',
  GET_SERVICE_LOCATIONS: 'tebra_get_service_locations',
} as const;

// ─── Types ──────────────────────────────────────────────────────

/**
 * New client registration data from allure-md.com.
 * Maps to Supabase client record fields.
 */
export interface NewClient {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  gender?: 'Male' | 'Female' | 'Other';
  address?: {
    street1: string;
    street2?: string;
    city: string;
    state: string;
    zip: string;
  };
  supabaseClientId: string;
  /** Optional: if known at registration time */
  primaryProviderId?: string;
  /** Optional: default service location */
  serviceLocationId?: string;
}

/**
 * Payment record from Stripe webhook or checkout completion.
 */
export interface PaymentRecord {
  /** Tebra patient ID (resolved from Supabase client ID) */
  tebraPatientId: string;
  /** Payment amount in dollars (e.g., 150.00) */
  amount: number;
  /** Date of payment (ISO 8601) */
  paymentDate: string;
  /** Stripe payment intent or charge ID for reference */
  stripePaymentId: string;
  /** Payment method description */
  paymentMethod: 'Credit Card' | 'Debit Card' | 'Other';
  /** Optional: service date the payment applies to */
  serviceDate?: string;
  /** Optional: Tebra provider ID */
  providerId?: string;
  /** Optional: specific charge ID to apply payment to */
  chargeId?: string;
  /** Optional: description/memo */
  description?: string;
}

/**
 * Result of patient creation in Tebra.
 */
interface TebraPatientCreateResult {
  patientId: string;
  status?: string;
  message?: string;
}

/**
 * Result of payment creation in Tebra.
 */
interface TebraPaymentResult {
  paymentId: string;
  status?: string;
}

// ─── MCP Client Interface ───────────────────────────────────────

export interface McpToolCaller {
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function parseToolResult<T>(result: McpToolResult): T {
  if (result.isError) {
    const errorText = result.content[0]?.text ?? 'Unknown MCP tool error';
    throw new Error(errorText);
  }
  const text = result.content[0]?.text ?? '{}';
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Unexpected non-JSON response from MCP tool: ${text}`);
  }
}

// ─── Service Functions ──────────────────────────────────────────

/**
 * Sync a new client from allure-md.com registration to Tebra.
 *
 * Flow:
 * 1. Check if patient already exists in Tebra (by name + DOB)
 * 2. If not found, create the patient
 * 3. Link the Supabase client ID as an external ID on the Tebra patient
 * 4. Return the Tebra patient ID
 *
 * @param mcp - MCP tool caller instance
 * @param client - New client registration data from Supabase
 * @returns Tebra patient ID (existing or newly created)
 */
export async function syncNewPatientToTebra(
  mcp: McpToolCaller,
  client: NewClient
): Promise<string> {
  // Step 1: Check for existing patient to avoid duplicates
  const existingId = await findExistingPatient(mcp, client);
  if (existingId) {
    // Patient already exists -- link external ID and return
    await linkExternalId(mcp, existingId, client.supabaseClientId);
    return existingId;
  }

  // Step 2: Create the patient in Tebra
  const createArgs: Record<string, unknown> = {
    firstName: client.firstName,
    lastName: client.lastName,
    dateOfBirth: client.dateOfBirth,
    emailAddress: client.email,
    homePhone: client.phone,
  };

  if (client.gender) {
    createArgs.gender = client.gender;
  }
  if (client.address) {
    createArgs.addressLine1 = client.address.street1;
    if (client.address.street2) {
      createArgs.addressLine2 = client.address.street2;
    }
    createArgs.city = client.address.city;
    createArgs.state = client.address.state;
    createArgs.zipCode = client.address.zip;
  }
  if (client.primaryProviderId) {
    createArgs.primaryProviderId = client.primaryProviderId;
  }
  if (client.serviceLocationId) {
    createArgs.serviceLocationId = client.serviceLocationId;
  }

  const result = await mcp.callTool(TOOL.CREATE_PATIENT, createArgs);
  const created = parseToolResult<TebraPatientCreateResult>(result);

  if (!created.patientId) {
    throw new Error('Tebra patient creation returned no patientId');
  }

  // Step 3: Link Supabase client ID as external ID
  await linkExternalId(mcp, created.patientId, client.supabaseClientId);

  return created.patientId;
}

/**
 * Post a payment to Tebra after a Stripe payment succeeds.
 *
 * Called from a Stripe webhook handler or after checkout completion.
 * Maps the Stripe payment to a Tebra payment record.
 *
 * @param mcp - MCP tool caller instance
 * @param payment - Payment details from Stripe
 */
export async function postPaymentToTebra(
  mcp: McpToolCaller,
  payment: PaymentRecord
): Promise<void> {
  const args: Record<string, unknown> = {
    patientId: payment.tebraPatientId,
    amount: payment.amount,
    paymentDate: payment.paymentDate,
    paymentMethod: payment.paymentMethod,
    referenceNumber: payment.stripePaymentId,
  };

  if (payment.serviceDate) {
    args.serviceDate = payment.serviceDate;
  }
  if (payment.providerId) {
    args.providerId = payment.providerId;
  }
  if (payment.chargeId) {
    args.chargeId = payment.chargeId;
  }
  if (payment.description) {
    args.description = payment.description ?? `Stripe payment ${payment.stripePaymentId}`;
  }

  const result = await mcp.callTool(TOOL.CREATE_PAYMENT, args);
  const parsed = parseToolResult<TebraPaymentResult>(result);

  if (!parsed.paymentId) {
    throw new Error(
      `Payment posting to Tebra failed for Stripe payment ${payment.stripePaymentId}`
    );
  }
}

/**
 * Link a Supabase client ID to a Tebra patient ID via the external ID system.
 *
 * Uses the tebra_update_patient_external_id tool to store the mapping.
 * This enables bidirectional lookup between systems.
 *
 * @param mcp - MCP tool caller instance
 * @param tebraPatientId - Tebra patient ID
 * @param supabaseClientId - Supabase client UUID
 */
export async function linkExternalId(
  mcp: McpToolCaller,
  tebraPatientId: string,
  supabaseClientId: string
): Promise<void> {
  await mcp.callTool(TOOL.UPDATE_PATIENT_EXTERNAL_ID, {
    patientId: tebraPatientId,
    externalId: supabaseClientId,
    externalVendorName: 'allure-md-supabase',
  });
}

// ─── Internal Helpers ───────────────────────────────────────────

/**
 * Search for an existing patient in Tebra by name.
 * Returns the patient ID if a match is found with matching DOB, null otherwise.
 */
async function findExistingPatient(
  mcp: McpToolCaller,
  client: NewClient
): Promise<string | null> {
  try {
    const searchQuery = `${client.lastName}, ${client.firstName}`;
    const result = await mcp.callTool(TOOL.SEARCH_PATIENTS, { query: searchQuery });
    const text = result.content[0]?.text ?? '';

    // Handle "No patients found" response
    if (text.startsWith('No patients')) {
      return null;
    }

    const patients = parseToolResult<Array<{
      patientId: string;
      firstName: string;
      lastName: string;
      dateOfBirth: string;
    }>>(result);

    // Match by name AND DOB to avoid false positives
    const match = patients.find(
      (p) =>
        p.firstName.toLowerCase() === client.firstName.toLowerCase() &&
        p.lastName.toLowerCase() === client.lastName.toLowerCase() &&
        normalizeDateString(p.dateOfBirth) === normalizeDateString(client.dateOfBirth)
    );

    return match?.patientId ?? null;
  } catch {
    // Search failed -- safer to create a new patient than to skip
    return null;
  }
}

/**
 * Normalize a date string to YYYY-MM-DD for comparison.
 */
function normalizeDateString(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toISOString().split('T')[0];
  } catch {
    return dateStr;
  }
}
