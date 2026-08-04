# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

MCP server that wraps the Tebra/Kareo SOAP API v2.1 and FHIR R4 API, exposing practice management and clinical data operations as MCP tools over stdio transport. Published to npm as `tebra-mcp-server`.

**Tool count**: 34 SOAP tools + 13 FHIR tools = 47 total.

## Commands

```bash
npm run build        # tsc — compiles to dist/
npm run dev          # tsx src/index.ts — runs directly without build
npm start            # node dist/index.js — runs compiled output
npm test             # node:test via tsx — src/__tests__/*.test.ts
```

Tests use node:test through tsx (no framework install). `src/__tests__/request-shapes.test.ts` pins the WSDL-derived request body for every builder — run it after touching ANY request XML; the live failure mode for a wrong body is a silent empty result, not an error. No linter is configured.

## Required Environment Variables

**SOAP (required)**: `TEBRA_SOAP_USER`, `TEBRA_SOAP_PASSWORD`, `TEBRA_CUSTOMER_KEY` — validated at startup by `getConfig()`. Optional: `TEBRA_SOAP_ENDPOINT` (defaults to Kareo production endpoint).

**FHIR (optional)**: `TEBRA_FHIR_CLIENT_ID`, `TEBRA_FHIR_CLIENT_SECRET` — if set, FHIR tools are registered. Optional: `TEBRA_FHIR_BASE_URL` (defaults to Tebra FHIR production endpoint).

## Architecture

**Transport**: stdio via `@modelcontextprotocol/sdk`. The server registers tools with `ListToolsRequestSchema` and routes calls through a switch in `CallToolRequestSchema` handler.

**SOAP client** (`src/soap-client.ts`): Hand-rolled XML — no SOAP library. Builds envelopes with `buildEnvelope()`, sends via `fetch`, parses responses with regex-based `extractTag`/`extractAllTags` helpers. Retries 3x with exponential backoff (1s, 2s, 4s). Per-endpoint rate limiting tracks request counts per SOAP action and delays when approaching limits.

**FHIR client** (`src/fhir-client.ts`): OAuth2 client credentials flow with automatic token caching. Tokens are refreshed 60 seconds before expiry; a 401 clears the cache and retries once. FHIR tools are conditionally registered — they only appear in the tool list when FHIR credentials are configured. All FHIR responses are parsed from FHIR R4 Bundle JSON into simplified structures, with Bundle pagination (`link[rel=next]`) followed automatically up to 10 pages via `searchFhir()` in `src/tools/fhir/helpers.ts`.

**FHIR endpoint quirks** (verified live 2026-08-03; details in `memory/project_tebra_fhir_endpoint_facts.md`): the base path is `/fhir-request` (HYPHEN — `/fhir/request` is wrong); unknown paths on that host return HTTP 200 with an EMPTY body instead of 404, so the client raises a descriptive error on empty 200s. Three resources require a second search param or return a silent empty bundle: MedicationRequest needs `intent`, CarePlan needs `category`, CareTeam needs `status` — the tools default these (`order`, `assess-plan`, `active`). FHIR patient IDs are a different identifier space from SOAP patient IDs; `tebra_fhir_search_patients` is the bridge.

**Tool modules** (`src/tools/*.ts` for SOAP, `src/tools/fhir/*.ts` for FHIR): Each exports a `*Tools` array (tool definitions with `inputSchema`) and a `handle*Tool` function returning `{ content: [{ type: 'text', text: string }] }`. SOAP handlers take `(name, args, config: TebraConfig)` because `TebraConfig` is threaded through. FHIR handlers take `(name, args)` and resolve their config internally via `getFhirConfig()` from `src/fhir-client.ts`. All responses are parsed into JSON before returning to the MCP client.

### Tool File Locations

Read-only "get" tools and CRUD/write tools are split into separate files for some resources (patients, appointments, encounters) so the read surface stays thin and write paths stay isolated. The `system.ts` module is a grab-bag for cross-cutting admin tools; new tools should generally land in a dedicated file rather than here.

```
src/tools/
  filter-helpers.ts       — shared list-GET body builders: buildListGetBody (empty Fields + Filter in WSDL order), rejectUnsupportedFilterArg (no tools — internal)
  patients.ts             — search, get (2 tools) + exported GetPatient body builder and patient parsers reused by authorizations/eligibility
  patient-crud.ts         — create, update (2 tools)
  bulk-patients.ts        — get-all (1 tool)
  authorizations.ts       — get patient authorizations (1 tool)
  eligibility.ts          — check insurance eligibility (1 tool)
  encounters.ts           — get, create (2 tools)
  encounter-status.ts     — update status (1 tool)
  appointments.ts         — get (list) (1 tool)
  appointment-detail.ts   — get detail (1 tool)
  appointment-crud.ts     — create, update, update-status, delete (4 tools)
  appointment-reasons.ts  — get reasons (1 tool)
  charges.ts              — get charges (1 tool; predates filter-helpers, keeps its own builder pinned by tests)
  payments.ts             — get, create (2 tools)
  transactions.ts         — get transactions (1 tool)
  providers.ts            — get providers (1 tool)
  service-locations.ts    — get service locations (1 tool)
  practices.ts            — get practices (1 tool)
  procedure-codes.ts      — get procedure codes (1 tool)
  documents.ts            — create, delete documents (2 tools)
  external-ids.ts         — register vendor, get vendors, update external ID (3 tools)
  system.ts               — validate connection, get throttles, set primary patient case, create appointment reason (4 tools)
  fhir/
    helpers.ts              — shared Bundle parsing, code/ref extractors, date-range builder, paginated searchFhir, MCP result formatter, Observation summarizer (no tools — internal)
    patients.ts             — tebra_fhir_search_patients (Patient — the SOAP↔FHIR ID bridge)
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

**Adding a new SOAP tool**: Create a file in `src/tools/`, export `<name>Tools` and `handle<Name>Tool(name, args, config)`, then in `src/index.ts` add the import, spread `<name>Tools` into `allTools`, and add a case to the switch statement (annotations are derived automatically from the tool-name verb). For a list GET, build the body with `buildListGetBody()` from `filter-helpers.ts` and a `FilterSequence` table copied from the WSDL `<xs:sequence>`. Export the body builder and add a case to `src/__tests__/request-shapes.test.ts`. **Read the Tebra SOAP wire-format quirks below before constructing any new request body** — the non-obvious requirements must all be satisfied or the call fails (usually silently) server-side.

**Adding a new FHIR tool**: Create a file in `src/tools/fhir/`, import shared helpers from `./helpers.js`, export `fhir<Resource>Tools` and `handleFhir<Resource>Tool(name, args)`, then in `src/index.ts` add the import, spread into the FHIR section of `allTools` (inside the `isFhirConfigured()` block), and add a case to the switch statement.

### Tebra SOAP Wire-Format Quirks

Tebra's WCF service rejects calls in four subtle ways that compound — each was fixed in a separate release because the previous bug masked the next. #1 and #2 are centralized in `src/soap-client.ts`; #3 and #4 are required of every GET tool's request body.

1. **`SOAPAction` header must include the `KareoServices/` contract segment** — `"http://www.kareo.com/api/schemas/KareoServices/<Operation>"`, double-quoted per RFC 3902 §3.2. Without `KareoServices/`: HTTP 500 `ContractFilter mismatch at the EndpointDispatcher`. Handled in `soapRequest()` automatically.

2. **`<RequestHeader>` children must appear in WSDL order**: `CustomerKey → Password → User` (not alphabetical). Wrong order silently fails authorization. Handled in `injectRequestHeader()` automatically.

3. **`<Filter />` must appear in every GET request body**, even when the WSDL marks it `minOccurs="0"`. Tebra's server-side `GetFilteredX(...)` methods dereference the filter parameter without null-checking and `NullReferenceException` if it's absent. Each GET tool is responsible for emitting `<kar:Filter />` (or a populated `<kar:Filter>...</kar:Filter>`) as a sibling after `<kar:Fields>`. Mirror the pattern from `src/tools/practices.ts`.

4. **List-GET projection inversion: `<kar:Fields/>` must be EMPTY.** Sending ANY explicit `<kar:X>true</kar:X>` column toggles makes Tebra return a single empty `<ChargeData/>`-style placeholder per call — zero real fields, no fault, regardless of filter matches (verified live 2026-07-07 on GetCharges; the EPIC-Notes connector documented the same behavior for GetCharges and GetPatients on 2026-05-03/2026-06-30). An empty `<kar:Fields/>` returns the FULL record, including columns the toggle form can never surface (e.g. the `PrimaryInsurance*` adjudication set). Response parsers must also drop placeholder blocks with an empty `<ID>`, or a no-match response counts as one phantom row. `src/tools/charges.ts` (0.3.1) is the reference implementation.

5. **WCF silently drops out-of-order and unknown members everywhere, not just in Filter.** Write operations (Create/Update/Delete) each have a specific wrapper element (`<Appointment>`, `<EncounterUpdateStatus>`, `<DocumentToCreate>`, `<Updates>`, ...) and their members must follow the type's `<xs:sequence>` order with EXACT case (`DocumentId`, not `DocumentID`; `externalID` camelCase inside `PatientExternalIDSetting`). The pre-0.4.0 create_patient sent `FirstName` first, which silently discarded every alphabetically-earlier member (address, DOB after LastName, etc.).

6. **Single-record ops have different contracts from their list counterparts.** `GetPatientReq` is Filter-only (SinglePatientFilter — no Fields member at all); `GetAppointmentReq` takes `<Appointment>{AppointmentId}`; `GetAppointmentReasonsReq` takes a bare optional `PracticeId`; `GetCustomerIdFromKeyRequest` takes bare CustomerKey/Password/User (it does not extend RequestBase). Never assume the Fields/Filter shape without reading the Req type.

Confirmed in writing by Tebra customer care 2026-04-28 (case `!00Do00KPG6.!500Rb01RoFOp`); quirks #4–6 verified against the live WSDL 2026-08-03. When adding a new operation, fetch the WSDL schema (`https://webservice.kareo.com/services/soap/2.1/KareoServices.svc?xsd=xsd0` or `?xsd=xsd7`) and follow the order shown in the `*Req` complexType `<xs:sequence>` — that is the source of truth for member order (but per quirk #4, never emit Fields toggles).

**Useful enum facts (from the WSDL)**: `EncounterStatusCode` = Draft | Submitted | Approved | Rejected | Unpayable — there is NO 'Review' status; Tebra's UI shows Submitted encounters under "Review". `AppointmentStatus` has 13 values (Scheduled, Confirmed, CheckedIn, Roomed, ReadyToBeSeen, CheckedOut, NoShow, Cancelled, ...). `GenderCode` = Male | Female | Unknown (no 'Other'). `Relationship` (guarantor) = Child | Other | Self | Spouse. `AppointmentFilter` has no ProviderID member (filter by ResourceName); `PaymentFilter` has no PatientID; `PatientFilter` has no MRN/ExternalID/exact-DOB (use `FromDateOfBirth`/`ToDateOfBirth`, capital O).

**Live-observed charge `Status` enum** (12-month pull, 2026-07-07): `Pending`, `Completed`, `Error - Rejection`, `Voided`, `Ready`. At least some accounts have NO `Denied` value — rejected/denied claims surface as `Error - Rejection`. Tebra also enforces a server-side **≤60-day posting-date window** on GetCharges (validation fault beyond that; prefer ≤30-day windows — wider windows have been observed to silently return 0).

**Resolved in 0.4.0**: the Fields/Filter misplacement that 0.3.0 fixed for charges affected every other list GET, and most write ops used wrong wrappers/member names — all rewritten against the live WSDL, with `src/__tests__/request-shapes.test.ts` pinning the shapes. Caveat: the 0.4.0 shapes are WSDL-derived and test-pinned but NOT yet smoke-tested against live Tebra (no credentials on the dev machine at fix time); smoke-test writes (create_patient, create_encounter, create_appointment) against live Tebra before relying on them in production.

## Key Design Decisions

- **XML parsing uses regex** (`extractTag`, `extractAllTags`, `extractNumber`) rather than a DOM parser — intentional to avoid dependencies. The helpers handle namespace prefixes.
- **Per-endpoint rate limiting**: The SOAP client tracks request counts per action name and enforces configurable per-endpoint limits. When approaching a limit, requests are delayed rather than rejected.
- **FHIR conditional registration**: FHIR tools are only registered when `TEBRA_FHIR_CLIENT_ID` and `TEBRA_FHIR_CLIENT_SECRET` are set. This keeps the tool list clean for SOAP-only users.
- **FHIR token caching**: OAuth2 tokens are cached in memory and refreshed 60 seconds before expiry to avoid mid-request auth failures.
- **Eligibility check is an approximation** from on-file insurance data, not a real-time payer query (Tebra SOAP API does not expose one).
- **Authorization status is computed locally**: `exhausted` (no remaining visits), `expired` (past end date), `pending` (no auth number), otherwise `active`.
- **The `TebraConfig` type is threaded** through every handler — no global state.
- **Encounter workflow**: Draft -> Submitted -> Approved (triggers billing) or Rejected (returns to Draft); Unpayable closes out. The WSDL enum is `EncounterStatusCode` — "Review" is a Tebra UI label for Submitted, not an API value.
- **Tool annotations are derived, not declared**: `src/index.ts` maps the tool-name verb (get/search/check/validate vs create vs update/set vs delete) to MCP `annotations` (readOnlyHint, destructiveHint, idempotentHint) at registration time.
