# tebra-mcp-server

[![npm version](https://img.shields.io/npm/v/tebra-mcp-server.svg)](https://www.npmjs.com/package/tebra-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

MCP server for [Tebra](https://www.tebra.com/) (formerly Kareo) practice management. Connects your existing Tebra account to Claude and other MCP-compatible AI agents, exposing **34 SOAP tools** and **13 FHIR clinical tools** for patients, encounters, appointments, billing, documents, insurance, and clinical data. Every request body is generated from the live Tebra WSDL contract (member names and sequence order verified against `KareoServices.svc?xsd=xsd0`/`xsd7`), with a regression suite locking the wire format in place. No data is accessible without valid Tebra API credentials.

### Hosted version available

Do not want to manage credentials, hosting, and updates yourself? [DOCK](https://dockhq.vercel.app) is the managed version of this server: encrypted per-practice auth, audit logs, draft-first write actions, and a workflow library. Founding practices lock lifetime pricing: Front Desk $49/mo (Zenoti), Billing Desk $99/mo (Tebra, BAA included), Full Practice $129/mo (both). https://dockhq.vercel.app

## Quick Start

```bash
npx tebra-mcp-server
```

## Prerequisites

- Node.js 18+
- Tebra SOAP API credentials (generated in Tebra PM admin under Settings > API)
- (Optional) Tebra FHIR API credentials for clinical data access

## Environment Variables

### SOAP API (required)

| Variable | Required | Description |
|---|---|---|
| `TEBRA_SOAP_USER` | Yes | SOAP API user (email) |
| `TEBRA_SOAP_PASSWORD` | Yes | SOAP API password |
| `TEBRA_CUSTOMER_KEY` | Yes | Customer key from Tebra PM admin |
| `TEBRA_SOAP_ENDPOINT` | No | Override SOAP endpoint (for testing) |

### FHIR API (optional -- enables 13 clinical data tools)

| Variable | Required | Description |
|---|---|---|
| `TEBRA_FHIR_CLIENT_ID` | For FHIR | OAuth2 client ID from Tebra appSphere registration |
| `TEBRA_FHIR_CLIENT_SECRET` | For FHIR | OAuth2 client secret |
| `TEBRA_FHIR_BASE_URL` | No | FHIR R4 base URL (defaults to `https://fhir.prd.cloud.tebra.com/fhir-request`) |
| `TEBRA_FHIR_TOKEN_URL` | No | OAuth2 token endpoint (defaults to Tebra production) |
| `TEBRA_FHIR_SCOPE` | No | OAuth2 scope (defaults to `system/*.read`; match your appSphere registration) |

FHIR credentials are obtained through Tebra appSphere. The server uses the OAuth2 client credentials flow with automatic token caching, refresh 60s before expiry, and a one-shot retry on 401. Note: both the practice and the backend-service client must be activated by Tebra Customer Care before tokens are issued — a 401 can mean "not yet activated" rather than "bad credentials".

## Installation

### Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "tebra": {
      "command": "npx",
      "args": ["-y", "tebra-mcp-server"],
      "env": {
        "TEBRA_SOAP_USER": "user@practice.com",
        "TEBRA_SOAP_PASSWORD": "your-password",
        "TEBRA_CUSTOMER_KEY": "your-customer-key",
        "TEBRA_FHIR_CLIENT_ID": "optional-fhir-client-id",
        "TEBRA_FHIR_CLIENT_SECRET": "optional-fhir-client-secret"
      }
    }
  }
}
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tebra": {
      "command": "npx",
      "args": ["-y", "tebra-mcp-server"],
      "env": {
        "TEBRA_SOAP_USER": "user@practice.com",
        "TEBRA_SOAP_PASSWORD": "your-password",
        "TEBRA_CUSTOMER_KEY": "your-customer-key"
      }
    }
  }
}
```

### Cursor / VS Code

Add to your MCP settings:

```json
{
  "mcpServers": {
    "tebra": {
      "command": "npx",
      "args": ["-y", "tebra-mcp-server"],
      "env": {
        "TEBRA_SOAP_USER": "user@practice.com",
        "TEBRA_SOAP_PASSWORD": "your-password",
        "TEBRA_CUSTOMER_KEY": "your-customer-key"
      }
    }
  }
}
```

## Available Tools (47 total)

### Patient Management

| Tool | Description |
|---|---|
| `tebra_search_patients` | Search patients by name, DOB range, insurance, practice, and more (16 server-side filters) |
| `tebra_get_patient` | Get full patient record (by Tebra ID or external ID) with cases, insurance policies, and authorizations |
| `tebra_create_patient` | Register a new patient with demographics, insurance, and guarantor |
| `tebra_update_patient` | Update patient demographics and contact info |
| `tebra_get_all_patients` | Bulk patient retrieval with pagination (for sync operations) |

### Appointments

| Tool | Description |
|---|---|
| `tebra_get_appointments` | Search appointments by date range, resource (provider), patient, status, location |
| `tebra_get_appointment_detail` | Get full appointment detail including recurrence, group data, and resources |
| `tebra_create_appointment` | Create an appointment (provider, location, start time + duration/end) |
| `tebra_update_appointment` | Update or reschedule an existing appointment |
| `tebra_update_appointment_status` | Change only the status (Confirmed, CheckedIn, NoShow, Cancelled, ...) |
| `tebra_delete_appointment` | Permanently delete an appointment |
| `tebra_get_appointment_reasons` | List configured appointment types/reasons for the practice |
| `tebra_create_appointment_reason` | Create a new appointment type/reason |

### Encounters & Billing

| Tool | Description |
|---|---|
| `tebra_get_encounter` | Get encounter details with status, providers, and service line IDs |
| `tebra_create_encounter` | Create an encounter (superbill) with per-line diagnoses and procedures |
| `tebra_update_encounter_status` | Workflow transitions: Draft -> Submitted -> Approved / Rejected / Unpayable |
| `tebra_get_charges` | Search charges with 18 filters (dates, patient name, provider, status) |
| `tebra_get_payments` | Search payment records by post date, payer, batch, reference number |
| `tebra_create_payment` | Post a payment to a patient account |

### Insurance & Authorizations

| Tool | Description |
|---|---|
| `tebra_get_patient_authorizations` | Get all authorizations with status, remaining visits, and CPT codes |
| `tebra_check_insurance_eligibility` | Check eligibility from on-file insurance data |

### Practice Configuration

| Tool | Description |
|---|---|
| `tebra_get_providers` | List all providers with IDs, specialties, and NPI numbers |
| `tebra_get_service_locations` | List practice locations with addresses and contact info |
| `tebra_get_practices` | Get practice metadata (name, tax ID, billing info) |
| `tebra_get_procedure_codes` | Get procedure code catalog with descriptions and default fees |

### Documents

| Tool | Description |
|---|---|
| `tebra_create_document` | Upload a document (PDF, image) to a patient's chart |
| `tebra_delete_document` | Remove a document from a patient's chart |

### Financial Analysis

| Tool | Description |
|---|---|
| `tebra_get_transactions` | Get granular transaction data for financial reporting |

### External Vendor & System

| Tool | Description |
|---|---|
| `tebra_validate_connection` | Health check -- verifies SOAP credentials and connectivity |
| `tebra_get_throttles` | Get current API rate limit status and remaining quota |
| `tebra_register_external_vendor` | Register an external vendor for ID linking |
| `tebra_get_external_vendors` | List registered external vendors |
| `tebra_update_patient_external_id` | Link an external system ID to a Tebra patient |
| `tebra_set_primary_patient_case` | Promote an existing patient case to primary (by case ID) |

### FHIR Clinical Data (requires FHIR credentials)

These tools access clinical data via the Tebra FHIR R4 API. They require separate FHIR credentials (see Environment Variables above). If FHIR credentials are not configured, these tools will not be registered.

FHIR patient IDs are a different identifier space from SOAP patient IDs — use `tebra_fhir_search_patients` to resolve them. All FHIR searches follow Bundle pagination automatically (up to 10 pages), and the three resources where Tebra requires a second search parameter (MedicationRequest `intent`, CarePlan `category`, CareTeam `status`) get sensible defaults so they don't silently return empty.

| Tool | Description |
|---|---|
| `tebra_fhir_search_patients` | Find FHIR patient IDs by name, birthdate, or identifier |
| `tebra_fhir_get_allergies` | Patient allergy and intolerance list |
| `tebra_fhir_get_medications` | Active and historical medication list |
| `tebra_fhir_get_conditions` | Problem list / active conditions |
| `tebra_fhir_get_vitals` | Recent vital signs (BP, HR, temp, weight, BMI) |
| `tebra_fhir_get_lab_results` | Lab results and observation values |
| `tebra_fhir_get_immunizations` | Vaccination records |
| `tebra_fhir_get_procedures` | Procedures performed |
| `tebra_fhir_get_care_plans` | Active care plans |
| `tebra_fhir_get_care_team` | Care team members and roles |
| `tebra_fhir_get_diagnostic_reports` | Diagnostic reports (radiology, pathology) |
| `tebra_fhir_get_documents` | Clinical documents (CDA, notes) |
| `tebra_fhir_get_devices` | Implantable devices (UDI data) |

## Rate Limits

The SOAP client enforces a minimum interval between calls per action, mirroring the throttling thresholds in the Tebra API Technical Guide. When a tool is called more frequently than its limit allows, the client sleeps just long enough to satisfy the interval before sending the request — calls are delayed, never dropped.

| Action | Min interval between calls |
|---|---|
| `GetPatient` | 250 ms |
| `GetPractices`, `GetProviders`, `GetServiceLocations`, `GetProcedureCodes`, `GetEncounterDetails`, `GetAppointment`, all `Create*` / `Update*` / `Delete*` | 500 ms |
| `GetPatients`, `GetAppointments`, `GetAppointmentReasons`, `GetCharges`, `GetPayments`, `GetTransactions`, `GetExternalVendors`, `UpdatePatient` | 1000 ms |
| `GetAllPatients`, `GetThrottles` | 5000 ms |

On top of client-side throttling, every SOAP call retries up to 3 times with exponential backoff (1s, 2s, 4s) before surfacing an error. Use `tebra_get_throttles` to query Tebra's server-side rate limit counters in real time.

## Example Workflows

### Scheduling Flow

```
1. tebra_get_providers          -- Get provider IDs
2. tebra_get_service_locations  -- Get location IDs
3. tebra_get_appointment_reasons -- Get reason/type IDs
4. tebra_create_appointment     -- Create with provider, location, reason IDs
5. tebra_get_appointment_detail -- Verify creation
```

### Encounter Approval Flow

```
1. tebra_create_encounter            -- Create superbill (status: Draft)
2. tebra_update_encounter_status     -- Move to Submitted (shows as "Review" in Tebra's UI)
3. tebra_update_encounter_status     -- Move to Approved (triggers billing)
   OR
3. tebra_update_encounter_status     -- Reject back to Draft
```

### Front-Desk Check-In Flow

```
1. tebra_get_appointments             -- Today's schedule (resourceName = provider)
2. tebra_update_appointment_status    -- CheckedIn on arrival
3. tebra_update_appointment_status    -- CheckedOut at departure
```

### Payment Posting Flow

```
1. tebra_search_patients    -- Find patient
2. tebra_get_charges        -- Find outstanding charges
3. tebra_create_payment     -- Post payment to patient account
4. tebra_get_payments       -- Verify payment posted
```

### Patient Onboarding

```
1. tebra_search_patients              -- Check for existing patient
2. tebra_create_patient               -- Create if not found
3. tebra_update_patient_external_id   -- Link Supabase client ID
4. tebra_create_appointment           -- Schedule first visit
```

### Clinical Context for Note Creation

```
1. tebra_get_appointments             -- Get today's schedule
2. tebra_get_appointment_detail       -- Get appointment context
3. tebra_get_patient                  -- Full patient demographics
4. tebra_get_patient_authorizations   -- Check auth status
5. tebra_fhir_get_allergies           -- Allergies
6. tebra_fhir_get_medications         -- Current medications
7. tebra_fhir_get_conditions          -- Problem list
8. tebra_fhir_get_vitals              -- Recent vitals
```

## Tool Dependency Chains

Some tools require IDs obtained from other tools. Key dependencies:

```
tebra_create_appointment
  requires: patientId    (from tebra_search_patients or tebra_create_patient)
  requires: providerId   (from tebra_get_providers)
  requires: locationId   (from tebra_get_service_locations)
  optional: reasonId     (from tebra_get_appointment_reasons)

tebra_create_encounter
  requires: patientId    (from tebra_search_patients)
  requires: providerId   (from tebra_get_providers)
  recommended: practiceName/practiceId (from tebra_get_practices)
  optional: authorization number (from tebra_get_patient_authorizations)

tebra_create_payment
  requires: patientId    (from tebra_search_patients)

tebra_update_encounter_status
  requires: encounterId  (from tebra_create_encounter or tebra_get_encounter)

tebra_create_document
  requires: patientId    (from tebra_search_patients)

tebra_update_patient_external_id
  requires: patientId        (from tebra_search_patients or tebra_create_patient)
  recommended: externalVendorId (from tebra_get_external_vendors)

tebra_set_primary_patient_case
  requires: patientCaseId (from tebra_get_patient — cases[].caseId)

All clinical tebra_fhir_get_* tools
  require: FHIR patientId (from tebra_fhir_search_patients — NOT the SOAP patient ID)
```

## API Reference

The server wraps two Tebra APIs:

**SOAP API v2.1** (34 tools)
- Endpoint: `https://webservice.kareo.com/services/soap/2.1/KareoServices.svc`
- Auth: RequestHeader with CustomerKey, Password, User (WSDL sequence order matters)
- Request bodies generated in WSDL (`?xsd=xsd0`/`xsd7`) member order — WCF silently drops out-of-order members
- All requests include retry with exponential backoff (3 attempts at 1s, 2s, 4s)

**FHIR R4 API** (13 tools)
- Endpoint: `https://fhir.prd.cloud.tebra.com/fhir-request` (note the hyphen — configurable via `TEBRA_FHIR_BASE_URL`)
- Auth: OAuth2 client credentials flow against `https://fhir.prd.cloud.tebra.com/smartauth/oauth/token`
- Token caching with automatic refresh before expiry and one-shot 401 retry
- Bundle pagination followed automatically (up to 10 pages per search)

## Development

```bash
git clone https://github.com/jamesrosing/tebra-mcp-server.git
cd tebra-mcp-server
npm install

npm run dev    # tsx — runs src/index.ts directly without a build step
npm run build  # tsc — compiles to dist/
npm test       # node:test via tsx — 37 regression tests covering wire-format invariants
npm start      # node dist/index.js — runs the compiled output
```

The regression suite pins the three Tebra wire-format invariants (SOAPAction contract segment, RequestHeader order, empty-Fields/populated-Filter) plus per-tool WSDL member order for every request builder — the failure mode for all of these is a silent empty result, not an error, so the tests are the only fast feedback loop.

## Roadmap

- Live smoke-test suite for the 0.4.0 write shapes against a sandbox practice (shapes are WSDL-derived and unit-pinned; production verification is the remaining step)
- Client-side pagination (`limit`/`offset` + `has_more`) on the large list tools, mirroring `tebra_get_all_patients`
- Zod runtime validation with `.strict()` schemas so misspelled arguments fail loudly instead of being dropped
- Migration from `Server.setRequestHandler` to the SDK's `McpServer`/`registerTool` API, adding `outputSchema`/`structuredContent`
- Agent-facing evaluation set (10 read-only, verifiable questions) to catch wrong-but-plausible data — the failure class unit tests cannot see

## Changelog

### 0.4.3 (2026-08-04)

- **fix(external IDs)**: fail closed on IDs over 25 characters in `tebra_create_patient` and `tebra_update_patient_external_id` — Tebra's external-ID storage silently truncates at 25 chars (verified live via a UNIQUE KEY collision on the truncated value), which breaks every later lookup by the full value. IDs are also unique per vendor. (This guard just missed the 0.4.2 tarball.)

### 0.4.2 (2026-08-04)

**The write path is now production-verified**: iterating a live write-smoke harness against a real practice confirmed CreatePatient, CreateAppointment, CreateDocument, and the external-ID batch + vendor-scoped lookup end-to-end (encounter write ops remain opt-in to verify). The runs surfaced four additional wire facts, all fixed here:

- **Required members** (`minOccurs` audit after CreatePatient faulted "Expecting element 'Practice'"): PatientCreate/PatientUpdate require `Practice`; AppointmentCreate requires `PracticeId`; AppointmentUpdate requires `PatientId`+`ServiceLocationId`; DocumentCreateRequest requires `PracticeId`.
- **External IDs are vendor-scoped, unique per vendor, and silently truncated at 25 characters** — writes with longer IDs now fail closed (truncation breaks every later lookup).
- **`DocumentDate` is a true `xs:dateTime`** — date-only input is normalized to ISO midnight; US-format strings fault the deserializer (Filter date members, being `xs:string`, still accept either).
- The `UpdatePatientsExternalID` response returns an empty `ItemsUpdated` echo even on success — verify via the vendor-scoped `ExternalID` lookup on `tebra_get_patient` instead.

Details:

- **fix(create/update_patient)**: `Practice` is a required member of PatientCreate AND PatientUpdate — now always emitted; when practiceName/practiceId are omitted, the account's first practice is auto-resolved via GetPractices (cached). `tebra_update_patient` gains optional practiceName/practiceId args.
- **fix(create_appointment)**: `PracticeId` is required — auto-resolved when omitted.
- **fix(update_appointment)**: `PatientId` and `ServiceLocationId` are required — auto-hydrated from GetAppointment when omitted, so a status-only or reschedule-only update still works.
- **fix(create_document)**: `PracticeId` is required — auto-resolved when omitted.
- Builders fail closed with clear messages if the required members are still missing; 3 new regression tests (39 total).

### 0.4.1 (2026-08-04)

Live production verification of the 0.4.0 shapes — a full read-only smoke pass (24 checks: every SOAP read tool plus the FHIR pipeline) now passes against a real Tebra practice. Fixes found only by going live:

- **fix(xsd7 namespace)**: GetServiceLocations and GetProcedureCodes faulted with "Expecting element 'Fields'" — xsd7's targetNamespace has NO trailing slash (`…/api/schemas` vs xsd0's `…/api/schemas/`), so their Fields/Filter members are different XML names. The envelope now declares both namespaces and those two tools emit `kar7:`-prefixed members.
- **fix(get_appointment_reasons)**: `PracticeId` is required by the WSDL (fault when omitted). The handler now auto-resolves the account's first practice ID via GetPractices (cached) when not supplied.
- **fix(search_patients)**: `ToDateOfBirth` is exclusive server-side — an exact `dateOfBirth` search now sends [DOB, DOB+1) instead of a zero-width range that matched nothing.
- **fix(rate limiting)**: +250ms safety margin per endpoint window — an exact-interval gap still trips Tebra's server-side 429; throttle errors (reported inside HTTP-200 ErrorResponse blocks) are now classified retryable.
- **fix(get_encounter)**: GetEncounterDetails returns EncounterStatus as a 1-based numeric code; now mapped to labels (3=Approved, verified live against the same encounter's charge rows).
- **fix(FHIR auth)**: on `invalid_scope`, the token server names the scope the client is registered with — the client now retries once with that scope automatically (registrations vary between `system/*.read` and `patient/*.read`).

### 0.4.0 (2026-08-03)

Full-surface WSDL contract audit. Every request builder was re-derived from the live WSDL (`KareoServices.svc?xsd=xsd0`/`xsd7`), which surfaced that the Fields/Filter misplacement fixed for GetCharges in 0.3.0 affected **every other list GET**, and that most write operations used wrong wrapper elements or member names. The failure mode in all cases is silent (unfiltered results, dropped fields, or server-side faults), which is why these survived so long. 26 new regression tests pin the corrected shapes.

- **fix(list GETs)**: patients, appointments, payments, transactions, providers, service-locations, procedure-codes, bulk-patients, and encounter-details now put criteria in `<kar:Filter>` (WSDL sequence order) with an empty `<kar:Fields/>` — previously all of their filter args were silently ignored, and every call returned the unfiltered set. Args with no WSDL filter member now fail closed with guidance (`patients.mrn`, `appointments.providerId` → use `resourceName`, `payments.patientId`).
- **fix(get_patient / authorizations / eligibility)**: `GetPatientReq` has no Fields member at all — the ID now goes in `Filter` (SinglePatientFilter), so single-patient lookup works. `tebra_get_patient` also gains lookup by `externalId`/`externalVendorId`.
- **fix(response parsers)**: real WSDL member names throughout — nested case/policy/authorization data (`PatientCaseData` → `PatientInsurancePolicyData` → `PatientInsurancePolicyAuthorizationData`, `AuthorizedNumberOfVisits`), `MedicalRecordNumber`, `NationalProviderIdentifier`, `PatientBatchData` + `nextStartKey` for bulk paging, `ThrottleDetail`, `ExternalVendorData`, `EncounterDetailsData`. Previous names matched nothing, so insurance/auth/case data always parsed empty. All list parsers drop Tebra's phantom empty placeholder row.
- **fix(writes)**: `create/update_patient` members re-ordered to WSDL sequence (out-of-order members were silently dropped — DOB, gender, email, address never persisted) with correct names (`SocialSecurityNumber`, `PatientExternalID`, `MedicalRecordNumber`) and insurance nested under `Cases → Policies`; `create/update_appointment` rewritten to the flat `AppointmentCreate/Update` shape (`StartTime`/`EndTime`, `PatientSummary`, `ProviderId`); `delete_appointment` wraps `Appointment`; `create_encounter` rewritten to `EncounterCreate` (per-service-line `DiagnosisCode1–4`, `RenderingProvider`, `Practice`); `update_encounter_status` wraps `EncounterUpdateStatus` with the real enum (`Draft/Submitted/Approved/Rejected/Unpayable` — "Review" is a UI label, not an API status); `create_payment` uses the `PaymentCreate` nested groups; `create_document` wraps `DocumentToCreate` in member order; `delete_document` sends `DocumentId` (case-sensitive); external-ID tools use `ExternalVendor` / `Updates→UpdateBatch` batch shapes; `create_appointment_reason` in member order with integer color; `validate_connection` sends the credentials `GetCustomerIdFromKeyRequest` actually expects.
- **change**: `tebra_update_patient_case` → `tebra_set_primary_patient_case` — the underlying op (`UpdatePrimaryPatientCase`) only promotes a case to primary by `PatientCaseId`; it never accepted name/payer-scenario edits. Old tool name still routes.
- **new**: `tebra_update_appointment_status` — targeted status changes (CheckedIn/NoShow/Cancelled...) via `UpdateAppointmentStatus`, cheaper than a full update.
- **fix(FHIR)**: default base URL corrected to `https://fhir.prd.cloud.tebra.com/fhir-request` (hyphen — the old `/fhir/request` path returns HTTP 200 with an empty body for every call, verified live 2026-08-03); empty-200 responses now raise a descriptive configuration error; 401 triggers one automatic token refresh + retry; from/to date ranges emit two repeated `date` params (previously percent-encoded into one malformed value); Bundle pagination followed automatically (`link[rel=next]`, up to 10 pages, truncation flagged); required second search params defaulted (`MedicationRequest intent=order`, `CarePlan category=assess-plan`, `CareTeam status=active`) — without them Tebra returns a silent empty bundle.
- **new**: `tebra_fhir_search_patients` — FHIR Patient lookup by name/birthdate/identifier; FHIR patient IDs are a separate identifier space from SOAP IDs and previously had no in-server resolution path.
- **fix(core)**: `extractTag`/`extractAllTags` require a tag-name boundary (`Patient` no longer matches `PatientData`); server version is read from package.json (was hardcoded `0.2.5`); server name corrected to `tebra-mcp-server`; rate-limit table keys `CreatePayment`/`UpdateAppointmentStatus`.

### 0.3.2 (2026-07-15)
- **chore**: removed the bundled project-specific integration templates (`src/integrations/epic-notes-integration.ts`, `src/integrations/fal-integration.ts`) and every reference to them (README "Integration Services" section, workflow-example labels, contributor docs). These were copy-paste connector modules for external downstream projects — never imported by the server and not part of its runtime — so they did not belong in the published package. No MCP tools were added or removed; the 45-tool surface is unchanged and the compiled tarball no longer ships `dist/integrations/`.

### 0.3.1 (2026-07-07)
- **fix(get_charges)**: `<kar:Fields/>` is now sent EMPTY. 0.3.0's explicit column toggles triggered Tebra's projection-inversion quirk — every call returned a single empty `<ChargeData/>` placeholder (zero real fields, no fault) regardless of filter matches. Empty Fields returns the full record, including the `PrimaryInsurance*` adjudication columns (payment, contract adjustment + reason, secondary adjustment + reason, adjudication date) the explicit toggles were meant to surface.
- Response parser (`parseChargeBlocks`, exported) drops the empty placeholder block — a no-match response previously counted as one phantom all-empty charge.
- `status` filter documented with live-observed enum values: `Pending`, `Completed`, `Error - Rejection`, `Voided`, `Ready`. At least some accounts have NO `Denied` status — denials surface as `Error - Rejection`.
- Verified live against production Tebra: a 12-month, 14-window pull returned 293 real charges with populated financials; server-side `Status` filtering confirmed working.

### 0.3.0 (2026-07-06)
- **fix(get_charges)**: filter criteria moved out of `<kar:Fields>` into `<kar:Filter>`, emitted in WSDL (xsd0) sequence order — inside Fields they were silently skipped by WCF, so GetCharges returned unfiltered data for the package's entire history. `patientId` now throws (ChargeFilter has no patient ID member; use `patientName`).
- Note: Tebra enforces a server-side ≤60-day posting-date window on GetCharges.

### 0.2.6 (2026-07-06)
- **fix(get_appointment_detail)**: `GetAppointment` does NOT take the `Fields`/`Filter` request shape the list endpoints use. Per the live WSDL (`KareoServices.svc?xsd=xsd0`), `GetAppointmentReq = RequestBase + <Appointment>{ AppointmentId: xs:long }` (lowercase "d"). The old envelope faulted on every call with `'EndElement' 'request' … Expecting element 'Appointment'`, so `tebra_get_appointment_detail` never worked against live Tebra.
- The response is the WSDL `AppointmentCreate` shape — patient nested under `<PatientSummary>` (group attendees under `<PatientSummaries>`), ISO `StartTime`/`EndTime`, `AppointmentStatus`, enum-letter `AppointmentType`. The tool's output now maps these real fields (patient name + DOB, appointment mode, reason id, recurrence, group attendees, audit timestamps) instead of the fictional `AppointmentData` field set.
- Verified live: full detail returned for a real appointment. Contributor lesson: single-record Tebra ops can have entirely different WSDL contracts from their list counterparts — read `?xsd=xsd0` before assuming the Fields/Filter pattern.

### 0.2.5 (2026-04-28)
- **fix(soap)**: every GET request body now includes a sibling `<kar:Filter />` after `<kar:Fields>`. Tebra's WSDL marks `Filter` as `minOccurs="0"`, but their server-side `GetFilteredX(...)` methods dereference the filter parameter without null-checking and throw `NullReferenceException` when it's absent. Tools patched: practices, providers, service-locations, procedure-codes, transactions, payments, charges, encounters, patients (search + get-by-id), bulk-patients, appointments. **Without 0.2.5, every GET call fails with a server-side NullRef.**
- Added regression test asserting `<kar:Filter />` is emitted in WSDL-required order (Fields before Filter).

### 0.2.4 (2026-04-28)
- **fix(soap)**: `<RequestHeader>` children now serialize in WSDL-required order (`CustomerKey → Password → User`). The previous `CustomerKey → User → Password` order caused silent authorization failures even with valid credentials. Confirmed in writing by Tebra customer care.

### 0.2.3 (2026-04-28)
- **fix(soap)**: `SOAPAction` HTTP header now includes the `KareoServices/` WCF contract segment that Kareo's dispatcher requires. Versions 0.2.2 and earlier sent `${SOAP_NAMESPACE}${operation}`, which the dispatcher rejected with HTTP 500 (`ContractFilter mismatch at the EndpointDispatcher`). Header value is now also explicitly quoted per RFC 3902 §3.2.
- Added a regression test asserting the exact header value (`npm test`).

### 0.2.2 (2026-04-27)
- **fix(soap)**: `RequestHeader` (User/Password/CustomerKey) is now placed inside the request body where Tebra's WSDL expects it, rather than in the SOAP envelope header.

### 0.2.1 (2026-04-26)
- Published to the MCP Registry under `com.jamesrosingmd/tebra` (verified-domain namespace).

### 0.2.0
- Initial public release.

> **Upgrade urgently from 0.2.4 or earlier.** All prior releases hit at least one of the three wire-format bugs above, and only 0.2.5 satisfies all three of Tebra's WSDL/runtime requirements end-to-end.

## License

MIT License

Copyright (c) 2026 James H. Rosing, MD, FACS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
