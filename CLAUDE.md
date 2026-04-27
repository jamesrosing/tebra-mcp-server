# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

MCP server that wraps the Tebra/Kareo SOAP API v2.1 and FHIR R4 API, exposing practice management and clinical data operations as MCP tools over stdio transport. Published to npm as `tebra-mcp-server`.

**Tool count**: 33 SOAP tools + 12 FHIR tools = 45 total.

## Commands

```bash
npm run build        # tsc — compiles to dist/
npm run dev          # tsx src/index.ts — runs directly without build
npm start            # node dist/index.js — runs compiled output
```

No test framework is configured. No linter is configured.

## Required Environment Variables

**SOAP (required)**: `TEBRA_SOAP_USER`, `TEBRA_SOAP_PASSWORD`, `TEBRA_CUSTOMER_KEY` — validated at startup by `getConfig()`. Optional: `TEBRA_SOAP_ENDPOINT` (defaults to Kareo production endpoint).

**FHIR (optional)**: `TEBRA_FHIR_CLIENT_ID`, `TEBRA_FHIR_CLIENT_SECRET` — if set, FHIR tools are registered. Optional: `TEBRA_FHIR_BASE_URL` (defaults to Tebra FHIR production endpoint).

## Architecture

**Transport**: stdio via `@modelcontextprotocol/sdk`. The server registers tools with `ListToolsRequestSchema` and routes calls through a switch in `CallToolRequestSchema` handler.

**SOAP client** (`src/soap-client.ts`): Hand-rolled XML — no SOAP library. Builds envelopes with `buildEnvelope()`, sends via `fetch`, parses responses with regex-based `extractTag`/`extractAllTags` helpers. Retries 3x with exponential backoff (1s, 2s, 4s). Per-endpoint rate limiting tracks request counts per SOAP action and delays when approaching limits.

**FHIR client** (`src/fhir-client.ts`): OAuth2 client credentials flow with automatic token caching. Tokens are refreshed 60 seconds before expiry. FHIR tools are conditionally registered — they only appear in the tool list when FHIR credentials are configured. All FHIR responses are parsed from FHIR R4 Bundle JSON into simplified structures.

**Tool modules** (`src/tools/*.ts` for SOAP, `src/tools/fhir/*.ts` for FHIR): Each exports a `*Tools` array (tool definitions with `inputSchema`) and a `handle*Tool` function returning `{ content: [{ type: 'text', text: string }] }`. SOAP handlers take `(name, args, config: TebraConfig)` because `TebraConfig` is threaded through. FHIR handlers take `(name, args)` and resolve their config internally via `getFhirConfig()` from `src/fhir-client.ts`. All responses are parsed into JSON before returning to the MCP client.

### Tool File Locations

Read-only "get" tools and CRUD/write tools are split into separate files for some resources (patients, appointments, encounters) so the read surface stays thin and write paths stay isolated. The `system.ts` module is a grab-bag for cross-cutting admin tools; new tools should generally land in a dedicated file rather than here.

```
src/tools/
  patients.ts             — search, get (2 tools)
  patient-crud.ts         — create, update (2 tools)
  bulk-patients.ts        — get-all (1 tool)
  authorizations.ts       — get patient authorizations (1 tool)
  eligibility.ts          — check insurance eligibility (1 tool)
  encounters.ts           — get, create (2 tools)
  encounter-status.ts     — update status (1 tool)
  appointments.ts         — get (list) (1 tool)
  appointment-detail.ts   — get detail (1 tool)
  appointment-crud.ts     — create, update, delete (3 tools)
  appointment-reasons.ts  — get reasons (1 tool)
  charges.ts              — get charges (1 tool)
  payments.ts             — get, create (2 tools)
  transactions.ts         — get transactions (1 tool)
  providers.ts            — get providers (1 tool)
  service-locations.ts    — get service locations (1 tool)
  practices.ts            — get practices (1 tool)
  procedure-codes.ts      — get procedure codes (1 tool)
  documents.ts            — create, delete documents (2 tools)
  external-ids.ts         — register vendor, get vendors, update external ID (3 tools)
  system.ts               — validate connection, get throttles, update patient case, create appointment reason (4 tools)
  fhir/
    helpers.ts              — shared Bundle parsing, code/ref extractors, date-range builder, MCP result formatter, Observation summarizer (no tools — internal)
    allergies.ts            — tebra_fhir_get_allergies (AllergyIntolerance)
    medications.ts          — tebra_fhir_get_medications (MedicationRequest)
    conditions.ts           — tebra_fhir_get_conditions (Condition)
    vitals.ts               — tebra_fhir_get_vitals (Observation, vital-signs category)
    lab-results.ts          — tebra_fhir_get_lab_results (Observation, laboratory category)
    immunizations.ts        — tebra_fhir_get_immunizations (Immunization)
    procedures.ts           — tebra_fhir_get_procedures (Procedure)
    care-plans.ts           — tebra_fhir_get_care_plans (CarePlan)
    care-team.ts            — tebra_fhir_get_care_team (CareTeam)
    diagnostic-reports.ts   — tebra_fhir_get_diagnostic_reports (DiagnosticReport)
    documents.ts            — tebra_fhir_get_documents (DocumentReference)
    devices.ts              — tebra_fhir_get_devices (Device)
```

### Integration Modules

```
src/integrations/
  epic-notes-integration.ts  — EPIC Notes schedule + note workflow service
  fal-integration.ts         — FAL patient sync + payment posting service
```

**Adding a new SOAP tool**: Create a file in `src/tools/`, export `<name>Tools` and `handle<Name>Tool(name, args, config)`, then in `src/index.ts` add the import, spread `<name>Tools` into `allTools`, and add a case to the switch statement.

**Adding a new FHIR tool**: Create a file in `src/tools/fhir/`, import shared helpers from `./helpers.js`, export `fhir<Resource>Tools` and `handleFhir<Resource>Tool(name, args)`, then in `src/index.ts` add the import, spread into the FHIR section of `allTools` (inside the `isFhirConfigured()` block), and add a case to the switch statement.

## Key Design Decisions

- **XML parsing uses regex** (`extractTag`, `extractAllTags`, `extractNumber`) rather than a DOM parser — intentional to avoid dependencies. The helpers handle namespace prefixes.
- **Per-endpoint rate limiting**: The SOAP client tracks request counts per action name and enforces configurable per-endpoint limits. When approaching a limit, requests are delayed rather than rejected.
- **FHIR conditional registration**: FHIR tools are only registered when `TEBRA_FHIR_CLIENT_ID` and `TEBRA_FHIR_CLIENT_SECRET` are set. This keeps the tool list clean for SOAP-only users.
- **FHIR token caching**: OAuth2 tokens are cached in memory and refreshed 60 seconds before expiry to avoid mid-request auth failures.
- **Eligibility check is an approximation** from on-file insurance data, not a real-time payer query (Tebra SOAP API does not expose one).
- **Authorization status is computed locally**: `exhausted` (no remaining visits), `expired` (past end date), `pending` (no auth number), otherwise `active`.
- **The `TebraConfig` type is threaded** through every handler — no global state.
- **Encounter workflow**: Draft -> Review -> Approved (triggers billing) or Rejected (returns to Draft). The `update_encounter_status` tool enforces valid transitions.
- **Integration services use an `McpToolCaller` interface** rather than importing the MCP SDK directly. This decouples them from transport implementation and makes them testable with mocks.

## Integration Points

### EPIC Notes (medical note-taking app)

The `epic-notes-integration.ts` module provides:
- `getTodaySchedule()` — pre-seeds the schedule view with today's Tebra appointments
- `getAppointmentContext()` — fetches patient + auth + clinical data in parallel for note creation
- `pushSignedNoteToTebra()` — creates encounter, uploads PDF, advances to Review status
- `uploadNoteToPaChart()` — uploads signed note PDF to patient chart

### FAL (allure-md.com)

The `fal-integration.ts` module provides:
- `syncNewPatientToTebra()` — deduplicates and creates patients, links Supabase IDs
- `postPaymentToTebra()` — posts Stripe payments to Tebra patient accounts
- `linkExternalId()` — links Supabase client UUIDs to Tebra patient IDs

Both integration modules define tool name constants at the top of the file, so tool name changes only require one update per module.
