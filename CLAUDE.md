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

**Tool modules** (`src/tools/*.ts`): Each exports a `*Tools` array (tool definitions with `inputSchema`) and a `handle*Tool` function. The handler receives `(name, args, config)` and returns `{ content: [{ type: 'text', text: string }] }`. All responses are parsed into JSON before returning to the MCP client.

### Tool File Locations

```
src/tools/
  patients.ts           — search, get, create, update, get-all (5 tools)
  appointments.ts       — get, get-detail, create, update, delete, reasons, create-reason (7 tools)
  encounters.ts         — get, create, update-status (3 tools)
  charges.ts            — get charges (1 tool)
  payments.ts           — get, create payments (2 tools)
  authorizations.ts     — get patient authorizations (1 tool)
  eligibility.ts        — check insurance eligibility (1 tool)
  procedure-codes.ts    — get procedure codes (1 tool)
  providers.ts          — get providers (1 tool)
  service-locations.ts  — get service locations (1 tool)
  practices.ts          — get practices (1 tool)
  documents.ts          — create, delete documents (2 tools)
  transactions.ts       — get transactions (1 tool)
  external-vendors.ts   — register, get vendors, update external ID (3 tools)
  patient-cases.ts      — update patient case (1 tool)
  system.ts             — validate connection, get throttles (2 tools)
  fhir/
    allergies.ts        — FHIR allergy/intolerance (1 tool)
    medications.ts      — FHIR medication list (1 tool)
    conditions.ts       — FHIR conditions/problem list (1 tool)
    vitals.ts           — FHIR vital signs (1 tool)
    lab-results.ts      — FHIR lab observations (1 tool)
    immunizations.ts    — FHIR immunizations (1 tool)
    procedures.ts       — FHIR procedures (1 tool)
    care-plans.ts       — FHIR care plans (1 tool)
    care-team.ts        — FHIR care team (1 tool)
    diagnostic-reports.ts — FHIR diagnostic reports (1 tool)
    documents.ts        — FHIR clinical documents (1 tool)
    devices.ts          — FHIR implantable devices (1 tool)
```

### Integration Modules

```
src/integrations/
  epic-notes-integration.ts  — EPIC Notes schedule + note workflow service
  fal-integration.ts         — FAL patient sync + payment posting service
```

**Adding a new tool**: Create a file in `src/tools/`, export the tools array and handler, import both in `src/index.ts`, spread into `allTools`, and add cases to the switch statement.

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
