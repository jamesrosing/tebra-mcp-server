---
name: tebra
description: Use this skill when working with Tebra/Kareo practice management, medical billing, patient records, appointment scheduling, encounter workflows, insurance authorizations, payment posting, or any healthcare PM integration. Also use when the user mentions Tebra, Kareo, superbills, CPT codes, ICD-10 codes in a billing context, or practice management operations.
---

# Tebra Practice Management

This skill provides guidance for using the Tebra MCP server tools effectively.

## Available Tool Categories

### Patient Management
- `tebra_search_patients` — Search by name, DOB, MRN, insurance, and 17 other filters
- `tebra_get_patient` — Full patient record with insurance and authorizations
- `tebra_create_patient` — Register new patient with demographics, insurance, guarantor
- `tebra_update_patient` — Update demographics, contact info, insurance
- `tebra_get_all_patients` — Bulk paginated retrieval (cursor-based)

### Appointments
- `tebra_get_appointments` — Search with 13 filters (status, provider, location, reason, date ranges)
- `tebra_get_appointment_detail` — Full detail including recurrence rules and group data
- `tebra_create_appointment` — Requires provider ID, location ID, reason ID, patient ID, start time
- `tebra_update_appointment` — Reschedule, check-in, no-show, cancel
- `tebra_delete_appointment` — Permanent deletion (prefer update with status=Cancelled)
- `tebra_get_appointment_reasons` — List appointment types with durations and IDs

### Encounters & Billing Workflow
- `tebra_get_encounter` — Encounter details with charges and procedures
- `tebra_create_encounter` — Create superbill with diagnoses (ICD-10) and procedures (CPT)
- `tebra_update_encounter_status` — Move through Draft -> Review -> Approved -> Rejected

### Financial
- `tebra_get_charges` — Search with 17 filters (date, provider, code, status, payer)
- `tebra_get_payments` — Payment records with date, payer, batch filters
- `tebra_create_payment` — Post payment (cash, check, credit card, EFT)
- `tebra_get_transactions` — Granular transaction-level data

### Insurance & Authorizations
- `tebra_get_patient_authorizations` — Auth numbers, approved/used/remaining visits, expiry
- `tebra_check_insurance_eligibility` — Eligibility approximation from on-file data

### Practice Configuration
- `tebra_get_providers` — Provider directory with IDs, NPI, specialties
- `tebra_get_service_locations` — Office locations with addresses and NPI
- `tebra_get_practices` — Practice metadata (NPI, TaxID, contacts)
- `tebra_get_procedure_codes` — CPT code catalog with fees

### Documents
- `tebra_create_document` — Upload PDF/image to patient chart (80+ label categories)
- `tebra_delete_document` — Remove document

### System
- `tebra_validate_connection` — Health check / credential validation
- `tebra_get_throttles` — Per-endpoint rate limit info

### FHIR Clinical Data (requires separate credentials)
Tools prefixed `tebra_fhir_` provide allergies, medications, conditions, vitals, lab results, immunizations, procedures, care plans, care team, diagnostic reports, documents, and devices.

## Common Workflows

### Schedule an Appointment
1. `tebra_get_providers` — resolve provider name to ID
2. `tebra_get_service_locations` — resolve location to ID
3. `tebra_get_appointment_reasons` — resolve appointment type to reason ID
4. `tebra_search_patients` — find the patient
5. `tebra_create_appointment` — create with all IDs

### Create and Submit an Encounter (Superbill)
1. `tebra_create_encounter` — with patient ID, provider ID, diagnoses, procedures
2. `tebra_update_encounter_status` — move to "Review"
3. `tebra_update_encounter_status` — move to "Approved" (triggers billing)

### Post a Payment
1. `tebra_search_patients` — find the patient
2. `tebra_create_payment` — with amount, method, reference number

### Check Authorization Before Procedure
1. `tebra_get_patient_authorizations` — check remaining visits and expiry
2. If active with remaining visits, proceed with encounter creation
3. If exhausted or expired, flag for re-authorization

## Rate Limits
The Tebra API enforces per-endpoint rate limits (e.g., GetPatient 250ms, GetPatients 1000ms). The MCP server handles this automatically with pre-emptive throttling. If you get a 429 error, wait and retry.

## Important Notes
- Eligibility check is an approximation from on-file data, not a real-time payer query
- Authorization status is computed: exhausted (no visits left), expired (past end date), pending (no auth number), active
- All dates use YYYY-MM-DD format
- Encounter status workflow: Draft -> Review -> Approved (triggers billing) or Rejected
- FHIR tools only appear when FHIR credentials are configured
