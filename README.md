# tebra-mcp-server

[![npm version](https://img.shields.io/npm/v/tebra-mcp-server.svg)](https://www.npmjs.com/package/tebra-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

MCP server for [Tebra](https://www.tebra.com/) (formerly Kareo) practice management. Connects your existing Tebra account to Claude and other MCP-compatible AI agents, exposing **33 SOAP tools** and **12 FHIR clinical tools** for patients, encounters, appointments, billing, documents, insurance, and clinical data. No data is accessible without valid Tebra API credentials.

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

### FHIR API (optional -- enables 12 clinical data tools)

| Variable | Required | Description |
|---|---|---|
| `TEBRA_FHIR_CLIENT_ID` | For FHIR | OAuth2 client ID from Tebra developer portal |
| `TEBRA_FHIR_CLIENT_SECRET` | For FHIR | OAuth2 client secret |
| `TEBRA_FHIR_BASE_URL` | No | FHIR R4 base URL (defaults to Tebra production) |

FHIR credentials are obtained from the Tebra Developer Portal under API > FHIR Access. The server uses OAuth2 client credentials flow with automatic token caching and refresh.

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

## Available Tools (45 total)

### Patient Management

| Tool | Description |
|---|---|
| `tebra_search_patients` | Search patients by name, DOB, MRN, or external ID (20+ filters) |
| `tebra_get_patient` | Get full patient record with insurance, cases, and authorizations |
| `tebra_create_patient` | Register a new patient with demographics and insurance |
| `tebra_update_patient` | Update patient demographics, contact info, or insurance |
| `tebra_get_all_patients` | Bulk patient retrieval with pagination (for sync operations) |

### Appointments

| Tool | Description |
|---|---|
| `tebra_get_appointments` | Search appointments by date range, provider, or patient |
| `tebra_get_appointment_detail` | Get full appointment detail including reason, notes, and history |
| `tebra_create_appointment` | Create an appointment (requires provider, location, reason IDs) |
| `tebra_update_appointment` | Update, reschedule, or cancel an existing appointment |
| `tebra_delete_appointment` | Permanently delete an appointment |
| `tebra_get_appointment_reasons` | List configured appointment types/reasons for the practice |
| `tebra_create_appointment_reason` | Create a new appointment type/reason |

### Encounters & Billing

| Tool | Description |
|---|---|
| `tebra_get_encounter` | Get encounter details with linked charges, diagnoses, and procedures |
| `tebra_create_encounter` | Create an encounter (superbill) with diagnoses and procedures |
| `tebra_update_encounter_status` | Workflow transitions: Draft -> Review -> Approved or Rejected |
| `tebra_get_charges` | Search charges with 20+ filters (date, patient, provider, status) |
| `tebra_get_payments` | Search payment records with date and patient filters |
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
| `tebra_update_patient_case` | Update a patient's case details |

### FHIR Clinical Data (requires FHIR credentials)

These tools access clinical data via the Tebra FHIR R4 API. They require separate FHIR credentials (see Environment Variables above). If FHIR credentials are not configured, these tools will not be registered.

| Tool | Description |
|---|---|
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
2. tebra_update_encounter_status     -- Move to Review
3. tebra_update_encounter_status     -- Move to Approved (triggers billing)
   OR
3. tebra_update_encounter_status     -- Reject back to Draft with reason
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
  requires: providerId   (from tebra_get_providers)
  requires: locationId   (from tebra_get_service_locations)
  requires: reasonId     (from tebra_get_appointment_reasons)
  optional: patientId    (from tebra_search_patients or tebra_create_patient)

tebra_create_encounter
  requires: patientId    (from tebra_search_patients)
  requires: providerId   (from tebra_get_providers)
  optional: authId       (from tebra_get_patient_authorizations)

tebra_create_payment
  requires: patientId    (from tebra_search_patients)

tebra_update_encounter_status
  requires: encounterId  (from tebra_create_encounter or tebra_get_encounter)

tebra_create_document
  requires: patientId    (from tebra_search_patients)

tebra_update_patient_external_id
  requires: patientId    (from tebra_search_patients or tebra_create_patient)

All FHIR tools
  require: patientId     (from tebra_search_patients)
```

## API Reference

The server wraps two Tebra APIs:

**SOAP API v2.1** (33 tools)
- Endpoint: `https://webservice.kareo.com/services/soap/2.1/KareoServices.svc`
- Auth: RequestHeader with User, Password, CustomerKey
- All requests include retry with exponential backoff (3 attempts at 1s, 2s, 4s)

**FHIR R4 API** (12 tools)
- Endpoint: `https://fhir.kareo.com/r4` (configurable)
- Auth: OAuth2 client credentials flow
- Token caching with automatic refresh before expiry

## Development

```bash
git clone https://github.com/jamesrosing/tebra-mcp-server.git
cd tebra-mcp-server
npm install

npm run dev    # tsx — runs src/index.ts directly without a build step
npm run build  # tsc — compiles to dist/
npm test       # node:test via tsx — runs the SOAP client regression suite
npm start      # node dist/index.js — runs the compiled output
```

## Changelog

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
