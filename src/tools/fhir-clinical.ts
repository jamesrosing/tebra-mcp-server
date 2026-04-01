/**
 * Tebra MCP tools: FHIR R4 clinical data retrieval.
 *
 * 12 tools for accessing clinical data via Tebra's FHIR API:
 * allergies, medications, conditions, vitals, labs, immunizations,
 * procedures, care plans, care team, diagnostic reports, documents, devices.
 *
 * Only registered when FHIR credentials are configured.
 */

import { fhirRequest, getFhirConfig } from '../fhir-client.js';

// ─── FHIR Bundle Helpers ────────────────────────────────────────

interface FhirResource {
  resourceType: string;
  [key: string]: unknown;
}

interface FhirBundleEntry {
  resource?: FhirResource;
  [key: string]: unknown;
}

interface FhirBundle {
  resourceType: string;
  total?: number;
  entry?: FhirBundleEntry[];
  [key: string]: unknown;
}

/**
 * Extract resources from a FHIR Bundle response.
 * Returns the resource array or an empty array if no entries.
 */
function extractBundleResources(bundle: unknown): FhirResource[] {
  const b = bundle as FhirBundle;
  if (!b?.entry || !Array.isArray(b.entry)) return [];
  return b.entry
    .filter((e: FhirBundleEntry) => e.resource)
    .map((e: FhirBundleEntry) => e.resource as FhirResource);
}

/** Extract a human-readable display from a CodeableConcept */
function codeDisplay(concept: unknown): string {
  if (!concept || typeof concept !== 'object') return '';
  const c = concept as { text?: string; coding?: Array<{ display?: string; code?: string }> };
  if (c.text) return c.text;
  if (c.coding?.[0]?.display) return c.coding[0].display;
  if (c.coding?.[0]?.code) return c.coding[0].code;
  return '';
}

/** Extract code value from a CodeableConcept */
function codeValue(concept: unknown): string {
  if (!concept || typeof concept !== 'object') return '';
  const c = concept as { coding?: Array<{ code?: string }> };
  return c.coding?.[0]?.code ?? '';
}

/** Extract a reference display */
function refDisplay(ref: unknown): string {
  if (!ref || typeof ref !== 'object') return '';
  const r = ref as { display?: string; reference?: string };
  return r.display ?? r.reference ?? '';
}

// ─── Resource Summarizers ───────────────────────────────────────

function summarizeAllergyIntolerance(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    substance: codeDisplay(r.code),
    clinicalStatus: codeDisplay(r.clinicalStatus),
    verificationStatus: codeDisplay(r.verificationStatus),
    type: r.type,
    category: r.category,
    criticality: r.criticality,
    recordedDate: r.recordedDate,
    reactions: Array.isArray(r.reaction)
      ? (r.reaction as Array<{ manifestation?: unknown[]; severity?: string }>).map((rx) => ({
          manifestations: rx.manifestation?.map((m: unknown) => codeDisplay(m)) ?? [],
          severity: rx.severity,
        }))
      : [],
  };
}

function summarizeMedicationRequest(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    medication: codeDisplay(r.medicationCodeableConcept) || refDisplay(r.medicationReference),
    status: r.status,
    intent: r.intent,
    authoredOn: r.authoredOn,
    requester: refDisplay(r.requester),
    dosageInstructions: Array.isArray(r.dosageInstruction)
      ? (r.dosageInstruction as Array<{ text?: string }>).map((d) => d.text).filter(Boolean)
      : [],
  };
}

function summarizeCondition(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    condition: codeDisplay(r.code),
    code: codeValue(r.code),
    clinicalStatus: codeDisplay(r.clinicalStatus),
    verificationStatus: codeDisplay(r.verificationStatus),
    category: Array.isArray(r.category)
      ? (r.category as unknown[]).map((c) => codeDisplay(c))
      : [],
    onsetDateTime: r.onsetDateTime,
    abatementDateTime: r.abatementDateTime,
    recordedDate: r.recordedDate,
  };
}

function summarizeObservation(r: FhirResource): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: r.id,
    type: codeDisplay(r.code),
    code: codeValue(r.code),
    status: r.status,
    effectiveDateTime: r.effectiveDateTime,
    issued: r.issued,
  };

  // Value can be in different shapes
  if (r.valueQuantity) {
    const vq = r.valueQuantity as { value?: number; unit?: string };
    result.value = vq.value;
    result.unit = vq.unit;
  } else if (r.valueCodeableConcept) {
    result.value = codeDisplay(r.valueCodeableConcept);
  } else if (r.valueString) {
    result.value = r.valueString;
  }

  // Reference ranges
  if (Array.isArray(r.referenceRange)) {
    result.referenceRange = (r.referenceRange as Array<{
      low?: { value?: number; unit?: string };
      high?: { value?: number; unit?: string };
      text?: string;
    }>).map((rr) => ({
      low: rr.low ? `${rr.low.value} ${rr.low.unit ?? ''}`.trim() : undefined,
      high: rr.high ? `${rr.high.value} ${rr.high.unit ?? ''}`.trim() : undefined,
      text: rr.text,
    }));
  }

  // Component observations (e.g., BP systolic/diastolic)
  if (Array.isArray(r.component)) {
    result.components = (r.component as Array<{
      code?: unknown;
      valueQuantity?: { value?: number; unit?: string };
    }>).map((comp) => ({
      type: codeDisplay(comp.code),
      value: comp.valueQuantity?.value,
      unit: comp.valueQuantity?.unit,
    }));
  }

  return result;
}

function summarizeImmunization(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    vaccine: codeDisplay(r.vaccineCode),
    status: r.status,
    occurrenceDateTime: r.occurrenceDateTime,
    primarySource: r.primarySource,
    performer: Array.isArray(r.performer)
      ? (r.performer as Array<{ actor?: unknown }>).map((p) => refDisplay(p.actor))
      : [],
  };
}

function summarizeProcedure(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    procedure: codeDisplay(r.code),
    code: codeValue(r.code),
    status: r.status,
    performedDateTime: r.performedDateTime,
    performedPeriod: r.performedPeriod,
    performer: Array.isArray(r.performer)
      ? (r.performer as Array<{ actor?: unknown }>).map((p) => refDisplay(p.actor))
      : [],
    reasonCode: Array.isArray(r.reasonCode)
      ? (r.reasonCode as unknown[]).map((c) => codeDisplay(c))
      : [],
  };
}

function summarizeCarePlan(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    intent: r.intent,
    category: Array.isArray(r.category)
      ? (r.category as unknown[]).map((c) => codeDisplay(c))
      : [],
    period: r.period,
    activities: Array.isArray(r.activity)
      ? (r.activity as Array<{ detail?: { code?: unknown; status?: string; description?: string } }>).map((a) => ({
          description: a.detail?.description,
          code: codeDisplay(a.detail?.code),
          status: a.detail?.status,
        }))
      : [],
  };
}

function summarizeCareTeam(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    participants: Array.isArray(r.participant)
      ? (r.participant as Array<{ role?: unknown[]; member?: unknown }>).map((p) => ({
          role: p.role?.map((role: unknown) => codeDisplay(role)),
          member: refDisplay(p.member),
        }))
      : [],
  };
}

function summarizeDiagnosticReport(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    type: codeDisplay(r.code),
    status: r.status,
    category: Array.isArray(r.category)
      ? (r.category as unknown[]).map((c) => codeDisplay(c))
      : [],
    effectiveDateTime: r.effectiveDateTime,
    issued: r.issued,
    conclusion: r.conclusion,
    results: Array.isArray(r.result)
      ? (r.result as unknown[]).map((res) => refDisplay(res))
      : [],
  };
}

function summarizeDocumentReference(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    type: codeDisplay(r.type),
    status: r.status,
    date: r.date,
    description: r.description,
    author: Array.isArray(r.author)
      ? (r.author as unknown[]).map((a) => refDisplay(a))
      : [],
    contentTypes: Array.isArray(r.content)
      ? (r.content as Array<{ attachment?: { contentType?: string; title?: string } }>).map((c) => ({
          contentType: c.attachment?.contentType,
          title: c.attachment?.title,
        }))
      : [],
  };
}

function summarizeDevice(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    type: codeDisplay(r.type),
    status: r.status,
    manufacturer: r.manufacturer,
    model: r.modelNumber,
    serialNumber: r.serialNumber,
    patient: refDisplay(r.patient),
    udiCarrier: Array.isArray(r.udiCarrier)
      ? (r.udiCarrier as Array<{ deviceIdentifier?: string }>).map((u) => u.deviceIdentifier)
      : [],
  };
}

// ─── Tool Definitions ───────────────────────────────────────────

export const fhirClinicalTools = [
  {
    name: 'tebra_fhir_get_allergies',
    description:
      'Get patient allergy and intolerance data from Tebra FHIR API. Returns substance, clinical status, criticality, and reactions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
      },
      required: ['patientId'],
    },
  },
  {
    name: 'tebra_fhir_get_medications',
    description:
      'Get patient medication requests from Tebra FHIR API. Returns medication name, dosage, status, and prescriber.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
        status: {
          type: 'string',
          enum: ['active', 'completed', 'stopped'],
          description: 'Filter by medication status',
        },
      },
      required: ['patientId'],
    },
  },
  {
    name: 'tebra_fhir_get_conditions',
    description:
      'Get patient conditions/diagnoses from Tebra FHIR API. Returns condition name, ICD code, clinical status, and onset date.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
        clinicalStatus: {
          type: 'string',
          enum: ['active', 'resolved', 'inactive'],
          description: 'Filter by clinical status',
        },
      },
      required: ['patientId'],
    },
  },
  {
    name: 'tebra_fhir_get_vitals',
    description:
      'Get patient vital signs from Tebra FHIR API. Returns BP, HR, temp, weight, height, BMI, SpO2, etc.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
        fromDate: {
          type: 'string',
          description: 'Date range start (YYYY-MM-DD)',
        },
        toDate: {
          type: 'string',
          description: 'Date range end (YYYY-MM-DD)',
        },
      },
      required: ['patientId'],
    },
  },
  {
    name: 'tebra_fhir_get_lab_results',
    description:
      'Get patient laboratory results from Tebra FHIR API. Returns test name, value, units, reference ranges.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
        fromDate: {
          type: 'string',
          description: 'Date range start (YYYY-MM-DD)',
        },
        toDate: {
          type: 'string',
          description: 'Date range end (YYYY-MM-DD)',
        },
        code: {
          type: 'string',
          description: 'LOINC code to filter by',
        },
      },
      required: ['patientId'],
    },
  },
  {
    name: 'tebra_fhir_get_immunizations',
    description:
      'Get patient immunization history from Tebra FHIR API. Returns vaccine name, date administered, and status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
      },
      required: ['patientId'],
    },
  },
  {
    name: 'tebra_fhir_get_procedures',
    description:
      'Get patient procedure history from Tebra FHIR API. Returns procedure name, CPT code, date, and performer.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
        fromDate: {
          type: 'string',
          description: 'Date range start (YYYY-MM-DD)',
        },
        toDate: {
          type: 'string',
          description: 'Date range end (YYYY-MM-DD)',
        },
      },
      required: ['patientId'],
    },
  },
  {
    name: 'tebra_fhir_get_care_plans',
    description:
      'Get patient care plans from Tebra FHIR API. Returns plan title, status, activities, and goals.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
        status: {
          type: 'string',
          enum: ['active', 'completed', 'draft', 'revoked'],
          description: 'Filter by care plan status',
        },
      },
      required: ['patientId'],
    },
  },
  {
    name: 'tebra_fhir_get_care_team',
    description:
      'Get patient care team from Tebra FHIR API. Returns team members with roles.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
      },
      required: ['patientId'],
    },
  },
  {
    name: 'tebra_fhir_get_diagnostic_reports',
    description:
      'Get patient diagnostic reports from Tebra FHIR API. Returns report type, status, conclusion, and linked results.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
        category: {
          type: 'string',
          enum: ['LAB', 'RAD', 'PATH'],
          description: 'Filter by category: LAB=Laboratory, RAD=Radiology, PATH=Pathology',
        },
      },
      required: ['patientId'],
    },
  },
  {
    name: 'tebra_fhir_get_documents',
    description:
      'Get patient document references from Tebra FHIR API. Returns document type, author, date, and content metadata.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
        type: {
          type: 'string',
          description: 'Document type code filter',
        },
      },
      required: ['patientId'],
    },
  },
  {
    name: 'tebra_fhir_get_devices',
    description:
      'Get patient-associated devices from Tebra FHIR API. Returns device type, manufacturer, model, and UDI.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
      },
      required: ['patientId'],
    },
  },
];

// ─── Tool Handler ───────────────────────────────────────────────

export async function handleFhirClinicalTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const config = getFhirConfig();
  const patientId = String(args.patientId ?? '');

  if (!patientId) {
    return { content: [{ type: 'text', text: 'patientId is required.' }] };
  }

  switch (name) {
    case 'tebra_fhir_get_allergies': {
      const data = await fhirRequest(config, 'AllergyIntolerance', { patient: patientId });
      const resources = extractBundleResources(data);
      return formatFhirResult(resources, 'allergies', summarizeAllergyIntolerance);
    }

    case 'tebra_fhir_get_medications': {
      const params: Record<string, string> = { patient: patientId };
      if (args.status) params.status = String(args.status);
      const data = await fhirRequest(config, 'MedicationRequest', params);
      const resources = extractBundleResources(data);
      return formatFhirResult(resources, 'medications', summarizeMedicationRequest);
    }

    case 'tebra_fhir_get_conditions': {
      const params: Record<string, string> = { patient: patientId };
      if (args.clinicalStatus) params['clinical-status'] = String(args.clinicalStatus);
      const data = await fhirRequest(config, 'Condition', params);
      const resources = extractBundleResources(data);
      return formatFhirResult(resources, 'conditions', summarizeCondition);
    }

    case 'tebra_fhir_get_vitals': {
      const params: Record<string, string> = {
        patient: patientId,
        category: 'vital-signs',
      };
      addDateRange(params, args);
      const data = await fhirRequest(config, 'Observation', params);
      const resources = extractBundleResources(data);
      return formatFhirResult(resources, 'vital signs', summarizeObservation);
    }

    case 'tebra_fhir_get_lab_results': {
      const params: Record<string, string> = {
        patient: patientId,
        category: 'laboratory',
      };
      addDateRange(params, args);
      if (args.code) params.code = String(args.code);
      const data = await fhirRequest(config, 'Observation', params);
      const resources = extractBundleResources(data);
      return formatFhirResult(resources, 'lab results', summarizeObservation);
    }

    case 'tebra_fhir_get_immunizations': {
      const data = await fhirRequest(config, 'Immunization', { patient: patientId });
      const resources = extractBundleResources(data);
      return formatFhirResult(resources, 'immunizations', summarizeImmunization);
    }

    case 'tebra_fhir_get_procedures': {
      const params: Record<string, string> = { patient: patientId };
      addDateRange(params, args);
      const data = await fhirRequest(config, 'Procedure', params);
      const resources = extractBundleResources(data);
      return formatFhirResult(resources, 'procedures', summarizeProcedure);
    }

    case 'tebra_fhir_get_care_plans': {
      const params: Record<string, string> = { patient: patientId };
      if (args.status) params.status = String(args.status);
      const data = await fhirRequest(config, 'CarePlan', params);
      const resources = extractBundleResources(data);
      return formatFhirResult(resources, 'care plans', summarizeCarePlan);
    }

    case 'tebra_fhir_get_care_team': {
      const data = await fhirRequest(config, 'CareTeam', { patient: patientId });
      const resources = extractBundleResources(data);
      return formatFhirResult(resources, 'care team records', summarizeCareTeam);
    }

    case 'tebra_fhir_get_diagnostic_reports': {
      const params: Record<string, string> = { patient: patientId };
      if (args.category) params.category = String(args.category);
      const data = await fhirRequest(config, 'DiagnosticReport', params);
      const resources = extractBundleResources(data);
      return formatFhirResult(resources, 'diagnostic reports', summarizeDiagnosticReport);
    }

    case 'tebra_fhir_get_documents': {
      const params: Record<string, string> = { patient: patientId };
      if (args.type) params.type = String(args.type);
      const data = await fhirRequest(config, 'DocumentReference', params);
      const resources = extractBundleResources(data);
      return formatFhirResult(resources, 'documents', summarizeDocumentReference);
    }

    case 'tebra_fhir_get_devices': {
      const data = await fhirRequest(config, 'Device', { patient: patientId });
      const resources = extractBundleResources(data);
      return formatFhirResult(resources, 'devices', summarizeDevice);
    }

    default:
      return { content: [{ type: 'text', text: `Unknown FHIR tool: ${name}` }] };
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function addDateRange(
  params: Record<string, string>,
  args: Record<string, unknown>,
): void {
  if (args.fromDate) params.date = `ge${String(args.fromDate)}`;
  if (args.toDate) {
    // FHIR allows multiple date params via comma for AND
    if (params.date) {
      params.date = `${params.date}&date=le${String(args.toDate)}`;
    } else {
      params.date = `le${String(args.toDate)}`;
    }
  }
}

function formatFhirResult(
  resources: FhirResource[],
  label: string,
  summarizer: (r: FhirResource) => Record<string, unknown>,
): { content: Array<{ type: string; text: string }> } {
  if (resources.length === 0) {
    return {
      content: [{ type: 'text', text: `No ${label} found for this patient.` }],
    };
  }

  const summarized = resources.map(summarizer);
  return {
    content: [{ type: 'text', text: JSON.stringify(summarized, null, 2) }],
  };
}
