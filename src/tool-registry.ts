/**
 * Side-effect-free aggregation of every tool definition. `src/index.ts`
 * starts the server on import, so anything that needs the tool list
 * without a running server (tests, the manifest check) reads it from here.
 */

import { patientTools } from './tools/patients.js';
import { encounterTools } from './tools/encounters.js';
import { authorizationTools } from './tools/authorizations.js';
import { appointmentTools } from './tools/appointments.js';
import { eligibilityTools } from './tools/eligibility.js';
import { chargeTools } from './tools/charges.js';
import { procedureCodeTools } from './tools/procedure-codes.js';
import { providerTools } from './tools/providers.js';
import { serviceLocationTools } from './tools/service-locations.js';
import { appointmentReasonTools } from './tools/appointment-reasons.js';
import { appointmentCrudTools } from './tools/appointment-crud.js';
import { appointmentDetailTools } from './tools/appointment-detail.js';
import { patientCrudTools } from './tools/patient-crud.js';
import { encounterStatusTools } from './tools/encounter-status.js';
import { paymentTools } from './tools/payments.js';
import { transactionTools } from './tools/transactions.js';
import { practiceTools } from './tools/practices.js';
import { documentTools } from './tools/documents.js';
import { bulkPatientTools } from './tools/bulk-patients.js';
import { externalIdTools } from './tools/external-ids.js';
import { systemTools } from './tools/system.js';

import { fhirAllergyTools } from './tools/fhir/allergies.js';
import { fhirMedicationTools } from './tools/fhir/medications.js';
import { fhirConditionTools } from './tools/fhir/conditions.js';
import { fhirVitalsTools } from './tools/fhir/vitals.js';
import { fhirLabResultsTools } from './tools/fhir/lab-results.js';
import { fhirImmunizationTools } from './tools/fhir/immunizations.js';
import { fhirProcedureTools } from './tools/fhir/procedures.js';
import { fhirCarePlanTools } from './tools/fhir/care-plans.js';
import { fhirCareTeamTools } from './tools/fhir/care-team.js';
import { fhirDiagnosticReportTools } from './tools/fhir/diagnostic-reports.js';
import { fhirDocumentTools } from './tools/fhir/documents.js';
import { fhirDeviceTools } from './tools/fhir/devices.js';
import { fhirPatientTools } from './tools/fhir/patients.js';

export const allSoapTools = [
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

export const allFhirTools = [
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
  ...fhirPatientTools,
];
