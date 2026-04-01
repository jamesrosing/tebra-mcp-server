/**
 * Tebra MCP Integration Service for EPIC Notes
 *
 * Wraps Tebra MCP tool calls for EPIC Notes use cases:
 * - Schedule pre-seeding (today's appointments for a provider)
 * - Appointment context for note creation
 * - Pushing signed notes back to Tebra (encounter + document upload)
 *
 * DEPLOYMENT: Copy this file to your EPIC Notes project:
 *   /src/lib/services/tebra-integration.ts
 *
 * This module communicates with the Tebra MCP server via an McpToolCaller
 * interface. Wire it to @modelcontextprotocol/sdk/client or any MCP-compatible
 * transport.
 *
 * The MCP server itself requires TEBRA_SOAP_USER, TEBRA_SOAP_PASSWORD,
 * and TEBRA_CUSTOMER_KEY in its environment.
 */

// ─── MCP Tool Name Constants ────────────────────────────────────
// Centralized so tool name changes only require one update.

const TOOL = {
  GET_APPOINTMENTS: 'tebra_get_appointments',
  GET_APPOINTMENT_DETAIL: 'tebra_get_appointment_detail',
  GET_PATIENT: 'tebra_get_patient',
  GET_PATIENT_AUTHORIZATIONS: 'tebra_get_patient_authorizations',
  CHECK_ELIGIBILITY: 'tebra_check_insurance_eligibility',
  CREATE_ENCOUNTER: 'tebra_create_encounter',
  UPDATE_ENCOUNTER_STATUS: 'tebra_update_encounter_status',
  CREATE_DOCUMENT: 'tebra_create_document',
  GET_PROVIDERS: 'tebra_get_providers',

  // FHIR tools for clinical context
  FHIR_GET_ALLERGIES: 'tebra_fhir_get_allergies',
  FHIR_GET_MEDICATIONS: 'tebra_fhir_get_medications',
  FHIR_GET_CONDITIONS: 'tebra_fhir_get_conditions',
  FHIR_GET_VITALS: 'tebra_fhir_get_vitals',
} as const;

// ─── Types ──────────────────────────────────────────────────────

export interface Appointment {
  appointmentId: string;
  patientId: string;
  patientName: string;
  providerId: string;
  providerName: string;
  startDate: string;
  endDate: string;
  type: string;
  status: string;
  reason?: string;
}

export interface PatientDemographics {
  patientId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  mrn: string;
  insurances: Array<{
    payerName: string;
    memberId: string;
    isPrimary: boolean;
  }>;
}

export interface Authorization {
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
}

export interface ClinicalSnapshot {
  allergies: string[];
  medications: string[];
  conditions: string[];
  recentVitals: Record<string, string> | null;
}

export interface EligibilityResult {
  eligible: boolean;
  planName: string | null;
  memberId: string | null;
  authRequired: boolean;
  insurancePoliciesOnFile: number;
}

export interface NoteCreationContext {
  appointment: Appointment;
  patient: PatientDemographics;
  authorizations: Authorization[];
  eligibility: EligibilityResult;
  clinical: ClinicalSnapshot | null;
}

export interface SignedNote {
  appointmentId: string;
  patientId: string;
  providerId: string;
  serviceDate: string;
  diagnoses: Array<{ code: string; description: string }>;
  procedures: Array<{ code: string; modifiers?: string[]; units?: number }>;
  authorizationId?: string;
  noteTitle: string;
  pdfBase64?: string;
}

export interface EncounterResult {
  encounterId: string;
  status: string;
}

// ─── MCP Client Interface ───────────────────────────────────────
// Abstracts the MCP tool call pattern so this module works with any
// MCP client implementation (SDK client, HTTP proxy, or mock).

export interface McpToolCaller {
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * Parse the text content from an MCP tool result.
 * Most Tebra tools return JSON in the first text content block.
 */
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
 * Get today's schedule for a provider.
 * Used to pre-seed the EPIC Notes schedule view when a provider opens the app.
 *
 * @param mcp - MCP tool caller instance
 * @param providerId - Optional Tebra provider ID. If omitted, returns all providers' appointments.
 * @returns Array of today's appointments sorted by start time
 */
export async function getTodaySchedule(
  mcp: McpToolCaller,
  providerId?: string
): Promise<Appointment[]> {
  const today = new Date().toISOString().split('T')[0];

  const args: Record<string, unknown> = {
    startDate: today,
    endDate: today,
  };
  if (providerId) {
    args.providerId = providerId;
  }

  const result = await mcp.callTool(TOOL.GET_APPOINTMENTS, args);
  const text = result.content[0]?.text ?? '';

  // Handle "No appointments found" responses gracefully
  if (text.startsWith('No appointments')) {
    return [];
  }

  const appointments = parseToolResult<Appointment[]>(result);
  return appointments.sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );
}

/**
 * Get full context for note creation when a provider taps an appointment.
 * Fetches patient demographics, authorizations, eligibility, and clinical data in parallel.
 *
 * @param mcp - MCP tool caller instance
 * @param appointmentId - Tebra appointment ID
 * @returns Complete context needed to populate a new note template
 */
export async function getAppointmentContext(
  mcp: McpToolCaller,
  appointmentId: string
): Promise<NoteCreationContext> {
  // Step 1: Get appointment detail to extract patientId
  const appointmentResult = await mcp.callTool(TOOL.GET_APPOINTMENT_DETAIL, {
    appointmentId,
  });
  const appointment = parseToolResult<Appointment>(appointmentResult);
  const { patientId } = appointment;

  // Step 2: Fetch patient data, authorizations, eligibility, and clinical in parallel
  const [patientResult, authResult, eligibilityResult, clinicalSnapshot] = await Promise.all([
    mcp.callTool(TOOL.GET_PATIENT, { patientId }),
    mcp.callTool(TOOL.GET_PATIENT_AUTHORIZATIONS, { patientId }),
    mcp.callTool(TOOL.CHECK_ELIGIBILITY, { patientId }),
    fetchClinicalSnapshot(mcp, patientId),
  ]);

  const patient = parseToolResult<PatientDemographics>(patientResult);

  // Authorizations may return "No authorizations found" -- not an error
  let authorizations: Authorization[] = [];
  try {
    authorizations = parseToolResult<Authorization[]>(authResult);
  } catch {
    // No authorizations on file
  }

  const eligibility = parseToolResult<EligibilityResult>(eligibilityResult);

  return {
    appointment,
    patient,
    authorizations,
    eligibility,
    clinical: clinicalSnapshot,
  };
}

/**
 * Push a signed note to Tebra: create an encounter (superbill) and optionally
 * upload the note PDF to the patient chart, then advance the encounter to
 * the Review status.
 *
 * @param mcp - MCP tool caller instance
 * @param note - Signed note data including diagnoses, procedures, and optional PDF
 * @returns The created encounter ID and final status
 */
export async function pushSignedNoteToTebra(
  mcp: McpToolCaller,
  note: SignedNote
): Promise<EncounterResult> {
  // Step 1: Create the encounter (superbill)
  const createResult = await mcp.callTool(TOOL.CREATE_ENCOUNTER, {
    patientId: note.patientId,
    providerId: note.providerId,
    serviceDate: note.serviceDate,
    diagnoses: note.diagnoses,
    procedures: note.procedures,
    authorizationId: note.authorizationId,
  });
  const encounter = parseToolResult<{ encounterId: string; status: string }>(createResult);

  // Step 2: Upload PDF and advance status in parallel
  const parallelOps: Promise<unknown>[] = [];

  if (note.pdfBase64) {
    parallelOps.push(
      uploadNoteToPaChart(mcp, note.patientId, note.noteTitle, note.serviceDate, note.pdfBase64)
    );
  }

  // Advance encounter to Review status
  parallelOps.push(
    mcp.callTool(TOOL.UPDATE_ENCOUNTER_STATUS, {
      encounterId: encounter.encounterId,
      status: 'Review',
    })
  );

  await Promise.all(parallelOps);

  return {
    encounterId: encounter.encounterId,
    status: 'Review',
  };
}

/**
 * Upload a signed note PDF to the patient's chart in Tebra.
 *
 * @param mcp - MCP tool caller instance
 * @param patientId - Tebra patient ID
 * @param noteTitle - Title for the document in Tebra
 * @param procedureDate - Date of the procedure/visit (ISO 8601)
 * @param pdfBase64 - Base64-encoded PDF content
 */
export async function uploadNoteToPaChart(
  mcp: McpToolCaller,
  patientId: string,
  noteTitle: string,
  procedureDate: string,
  pdfBase64: string
): Promise<void> {
  await mcp.callTool(TOOL.CREATE_DOCUMENT, {
    patientId,
    title: noteTitle,
    date: procedureDate,
    contentBase64: pdfBase64,
    contentType: 'application/pdf',
  });
}

// ─── Internal Helpers ───────────────────────────────────────────

/**
 * Fetch clinical snapshot from FHIR endpoints.
 * Returns null if FHIR credentials are not configured (non-fatal).
 */
async function fetchClinicalSnapshot(
  mcp: McpToolCaller,
  patientId: string
): Promise<ClinicalSnapshot | null> {
  try {
    const [allergiesResult, medsResult, conditionsResult, vitalsResult] = await Promise.all([
      mcp.callTool(TOOL.FHIR_GET_ALLERGIES, { patientId }),
      mcp.callTool(TOOL.FHIR_GET_MEDICATIONS, { patientId }),
      mcp.callTool(TOOL.FHIR_GET_CONDITIONS, { patientId }),
      mcp.callTool(TOOL.FHIR_GET_VITALS, { patientId }),
    ]);

    return {
      allergies: safeParseStringArray(allergiesResult),
      medications: safeParseStringArray(medsResult),
      conditions: safeParseStringArray(conditionsResult),
      recentVitals: safeParseRecord(vitalsResult),
    };
  } catch {
    // FHIR not configured or unavailable -- degrade gracefully
    return null;
  }
}

function safeParseStringArray(result: McpToolResult): string[] {
  try {
    const parsed = JSON.parse(result.content[0]?.text ?? '[]');
    if (Array.isArray(parsed)) {
      return parsed.map((item: unknown) =>
        typeof item === 'string' ? item : JSON.stringify(item)
      );
    }
    return [];
  } catch {
    return [];
  }
}

function safeParseRecord(result: McpToolResult): Record<string, string> | null {
  try {
    const parsed = JSON.parse(result.content[0]?.text ?? 'null');
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
