#!/usr/bin/env node

/**
 * Tebra MCP Server entry point.
 *
 * Exposes Tebra/Kareo practice management operations as MCP tools
 * for use with Claude Code, Claude Desktop, or any MCP-compatible client.
 *
 * Environment variables:
 *   TEBRA_SOAP_USER      — SOAP API user (email)
 *   TEBRA_SOAP_PASSWORD   — SOAP API password
 *   TEBRA_CUSTOMER_KEY    — Customer key from Tebra PM admin
 *
 * Optional FHIR (clinical data):
 *   TEBRA_FHIR_CLIENT_ID     — FHIR OAuth2 client ID
 *   TEBRA_FHIR_CLIENT_SECRET — FHIR OAuth2 client secret
 *
 * Usage:
 *   npx @allure-md/tebra-mcp-server
 *   TEBRA_SOAP_USER=... TEBRA_SOAP_PASSWORD=... TEBRA_CUSTOMER_KEY=... node dist/index.js
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { getConfig } from './config.js';
import { isFhirConfigured } from './fhir-client.js';

// SOAP tool imports
import { patientTools, handlePatientTool } from './tools/patients.js';
import { encounterTools, handleEncounterTool } from './tools/encounters.js';
import { authorizationTools, handleAuthorizationTool } from './tools/authorizations.js';
import { appointmentTools, handleAppointmentTool } from './tools/appointments.js';
import { eligibilityTools, handleEligibilityTool } from './tools/eligibility.js';
import { chargeTools, handleChargeTool } from './tools/charges.js';
import { procedureCodeTools, handleProcedureCodeTool } from './tools/procedure-codes.js';
import { providerTools, handleProviderTool } from './tools/providers.js';
import { serviceLocationTools, handleServiceLocationTool } from './tools/service-locations.js';
import { appointmentReasonTools, handleAppointmentReasonTool } from './tools/appointment-reasons.js';
import { appointmentCrudTools, handleAppointmentCrudTool } from './tools/appointment-crud.js';
import { appointmentDetailTools, handleAppointmentDetailTool } from './tools/appointment-detail.js';
import { patientCrudTools, handlePatientCrudTool } from './tools/patient-crud.js';
import { encounterStatusTools, handleEncounterStatusTool } from './tools/encounter-status.js';
import { paymentTools, handlePaymentTool } from './tools/payments.js';
import { transactionTools, handleTransactionTool } from './tools/transactions.js';
import { practiceTools, handlePracticeTool } from './tools/practices.js';
import { documentTools, handleDocumentTool } from './tools/documents.js';
import { bulkPatientTools, handleBulkPatientTool } from './tools/bulk-patients.js';
import { externalIdTools, handleExternalIdTool } from './tools/external-ids.js';
import { systemTools, handleSystemTool } from './tools/system.js';

// FHIR tool imports — one file per resource
import { fhirAllergyTools, handleFhirAllergyTool } from './tools/fhir/allergies.js';
import { fhirMedicationTools, handleFhirMedicationTool } from './tools/fhir/medications.js';
import { fhirConditionTools, handleFhirConditionTool } from './tools/fhir/conditions.js';
import { fhirVitalsTools, handleFhirVitalsTool } from './tools/fhir/vitals.js';
import { fhirLabResultsTools, handleFhirLabResultsTool } from './tools/fhir/lab-results.js';
import { fhirImmunizationTools, handleFhirImmunizationTool } from './tools/fhir/immunizations.js';
import { fhirProcedureTools, handleFhirProcedureTool } from './tools/fhir/procedures.js';
import { fhirCarePlanTools, handleFhirCarePlanTool } from './tools/fhir/care-plans.js';
import { fhirCareTeamTools, handleFhirCareTeamTool } from './tools/fhir/care-team.js';
import { fhirDiagnosticReportTools, handleFhirDiagnosticReportTool } from './tools/fhir/diagnostic-reports.js';
import { fhirDocumentTools, handleFhirDocumentTool } from './tools/fhir/documents.js';
import { fhirDeviceTools, handleFhirDeviceTool } from './tools/fhir/devices.js';

// ─── Validate config on startup ─────────────────────────────────

const config = getConfig();

// ─── Create MCP Server ──────────────────────────────────────────

const server = new Server(
  {
    name: '@allure-md/tebra-mcp-server',
    version: '0.2.2',  // Keep in sync with package.json
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ─── Aggregate all tools ────────────────────────────────────────

const allTools = [
  ...patientTools,
  ...encounterTools,
  ...authorizationTools,
  ...appointmentTools,
  ...eligibilityTools,
  ...chargeTools,
  ...procedureCodeTools,
  ...providerTools,
  ...serviceLocationTools,
  ...appointmentReasonTools,
  ...appointmentCrudTools,
  ...appointmentDetailTools,
  ...patientCrudTools,
  ...encounterStatusTools,
  ...paymentTools,
  ...transactionTools,
  ...practiceTools,
  ...documentTools,
  ...bulkPatientTools,
  ...externalIdTools,
  ...systemTools,
];

// Conditionally register FHIR tools when credentials are available
if (isFhirConfigured()) {
  allTools.push(
    ...fhirAllergyTools,
    ...fhirMedicationTools,
    ...fhirConditionTools,
    ...fhirVitalsTools,
    ...fhirLabResultsTools,
    ...fhirImmunizationTools,
    ...fhirProcedureTools,
    ...fhirCarePlanTools,
    ...fhirCareTeamTools,
    ...fhirDiagnosticReportTools,
    ...fhirDocumentTools,
    ...fhirDeviceTools,
  );
  console.error('FHIR tools enabled — 12 clinical data tools registered');
} else {
  console.error('FHIR tools disabled — set TEBRA_FHIR_CLIENT_ID and TEBRA_FHIR_CLIENT_SECRET to enable clinical data tools');
}

console.error(`Tebra MCP server: ${allTools.length} tools registered`);

// ─── Tool Listing ───────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: allTools };
});

// ─── Tool Execution ─────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const safeArgs = args ?? {};

    switch (name) {
      // ─── Patient tools ──────────────────────────────
      case 'tebra_search_patients':
      case 'tebra_get_patient':
        return await handlePatientTool(name, safeArgs, config);

      case 'tebra_create_patient':
      case 'tebra_update_patient':
        return await handlePatientCrudTool(name, safeArgs, config);

      case 'tebra_get_all_patients':
        return await handleBulkPatientTool(name, safeArgs, config);

      // ─── Authorization & eligibility ────────────────
      case 'tebra_get_patient_authorizations':
        return await handleAuthorizationTool(name, safeArgs, config);

      case 'tebra_check_insurance_eligibility':
        return await handleEligibilityTool(name, safeArgs, config);

      // ─── Encounter tools ────────────────────────────
      case 'tebra_get_encounter':
      case 'tebra_create_encounter':
        return await handleEncounterTool(name, safeArgs, config);

      case 'tebra_update_encounter_status':
        return await handleEncounterStatusTool(name, safeArgs, config);

      // ─── Appointment tools ──────────────────────────
      case 'tebra_get_appointments':
        return await handleAppointmentTool(name, safeArgs, config);

      case 'tebra_get_appointment_detail':
        return await handleAppointmentDetailTool(name, safeArgs, config);

      case 'tebra_create_appointment':
      case 'tebra_update_appointment':
      case 'tebra_delete_appointment':
        return await handleAppointmentCrudTool(name, safeArgs, config);

      case 'tebra_get_appointment_reasons':
        return await handleAppointmentReasonTool(name, safeArgs, config);

      // ─── Financial tools ────────────────────────────
      case 'tebra_get_charges':
        return await handleChargeTool(name, safeArgs, config);

      case 'tebra_get_payments':
      case 'tebra_create_payment':
        return await handlePaymentTool(name, safeArgs, config);

      case 'tebra_get_transactions':
        return await handleTransactionTool(name, safeArgs, config);

      // ─── Practice configuration ─────────────────────
      case 'tebra_get_providers':
        return await handleProviderTool(name, safeArgs, config);

      case 'tebra_get_service_locations':
        return await handleServiceLocationTool(name, safeArgs, config);

      case 'tebra_get_practices':
        return await handlePracticeTool(name, safeArgs, config);

      case 'tebra_get_procedure_codes':
        return await handleProcedureCodeTool(name, safeArgs, config);

      // ─── Document tools ─────────────────────────────
      case 'tebra_create_document':
      case 'tebra_delete_document':
        return await handleDocumentTool(name, safeArgs, config);

      // ─── System / admin tools ───────────────────────
      case 'tebra_update_patient_external_id':
      case 'tebra_register_external_vendor':
      case 'tebra_get_external_vendors':
        return await handleExternalIdTool(name, safeArgs, config);

      case 'tebra_get_throttles':
      case 'tebra_validate_connection':
      case 'tebra_update_patient_case':
      case 'tebra_create_appointment_reason':
        return await handleSystemTool(name, safeArgs, config);

      // ─── FHIR tools (one file per resource) ─────────
      case 'tebra_fhir_get_allergies':
        return await handleFhirAllergyTool(name, safeArgs);

      case 'tebra_fhir_get_medications':
        return await handleFhirMedicationTool(name, safeArgs);

      case 'tebra_fhir_get_conditions':
        return await handleFhirConditionTool(name, safeArgs);

      case 'tebra_fhir_get_vitals':
        return await handleFhirVitalsTool(name, safeArgs);

      case 'tebra_fhir_get_lab_results':
        return await handleFhirLabResultsTool(name, safeArgs);

      case 'tebra_fhir_get_immunizations':
        return await handleFhirImmunizationTool(name, safeArgs);

      case 'tebra_fhir_get_procedures':
        return await handleFhirProcedureTool(name, safeArgs);

      case 'tebra_fhir_get_care_plans':
        return await handleFhirCarePlanTool(name, safeArgs);

      case 'tebra_fhir_get_care_team':
        return await handleFhirCareTeamTool(name, safeArgs);

      case 'tebra_fhir_get_diagnostic_reports':
        return await handleFhirDiagnosticReportTool(name, safeArgs);

      case 'tebra_fhir_get_documents':
        return await handleFhirDocumentTool(name, safeArgs);

      case 'tebra_fhir_get_devices':
        return await handleFhirDeviceTool(name, safeArgs);

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error in ${name}: ${message}` }],
      isError: true,
    };
  }
});

// ─── Start Server ───────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Tebra MCP server failed to start:', error);
  process.exit(1);
});
