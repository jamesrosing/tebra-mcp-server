# Privacy Policy — tebra-mcp-server

Effective 2026-09-19. Applies to the `tebra-mcp-server` npm package and the
`tebra-mcp-server.mcpb` desktop extension built from this repository.

## Who operates this software

tebra-mcp-server is an independent open-source project maintained by James H.
Rosing, MD, FACS. It is not affiliated with, endorsed by, or supported by
Tebra Technologies, Inc. (formerly Kareo) or by Anthropic. Use of the Tebra
API is governed by your own Tebra agreement.

## What the server does with data

The server runs locally on your machine as a stdio process launched by your
MCP client (Claude Desktop, Claude Code, Cursor, or similar). It has no
backend of its own. Every request goes directly from the process on your
machine to Tebra's API endpoints:

- `https://webservice.kareo.com/services/soap/2.1/KareoServices.svc` (SOAP)
- `https://fhir.prd.cloud.tebra.com/fhir-request` and `/smartauth/oauth/token` (FHIR)

Both are overridable through `TEBRA_SOAP_ENDPOINT`, `TEBRA_FHIR_BASE_URL`,
and `TEBRA_FHIR_TOKEN_URL`. No data is sent anywhere else by this software.

## Data we do not collect

The maintainer collects nothing. There is no telemetry, analytics,
crash reporting, usage tracking, or phone-home behavior of any kind.

## Credentials

Tebra SOAP credentials and FHIR client credentials are read from environment
variables (or the desktop extension's user configuration, which stores them
in the operating system keychain) and held in process memory only. A FHIR
private key is read from disk once and never transmitted; only a short-lived
signed assertion leaves the machine. Credentials are redacted from the
optional debug log before it is written.

## Protected health information (PHI)

Tool results are returned to the MCP client that called them and contain
whatever the Tebra API returned: patient demographics, insurance, scheduling,
encounters, charges, and clinical data. That is PHI under HIPAA.

- Nothing is persisted by this server. There is no cache, database, or file
  written by the server other than the optional stderr debug log, from which
  patient identifiers are scrubbed before writing.
- Error messages returned to the client are scrubbed of the patient
  identifiers present in the request that caused them.
- Record-returning tools accept a `fields` argument for minimum-necessary
  selection, and `tebra_get_patient` omits insurance policy and group
  numbers unless they are named explicitly.

Once results leave this server they are handled by the MCP client and the
model behind it. Sending PHI to Claude requires a Claude plan under which
Anthropic signs a Business Associate Agreement (BAA). Consumer Claude plans
are not covered. Confirming that a BAA is in place, and that your Tebra API
user is scoped appropriately, is the responsibility of the covered entity
operating this software.

## Third parties

The only third party that receives data is Tebra, through the API you
authenticate to with your own credentials. Tebra's handling of that data is
governed by Tebra's privacy policy and your agreement with Tebra.

## Changes

Changes to this policy are recorded in this repository's git history and
noted in the README changelog.

## Contact

Open an issue at https://github.com/jamesrosing/tebra-mcp-server/issues or
email james@allure-md.com.
