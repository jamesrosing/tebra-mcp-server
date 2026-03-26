# tebra-mcp-server

[![npm version](https://img.shields.io/npm/v/tebra-mcp-server.svg)](https://www.npmjs.com/package/tebra-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

MCP server for [Tebra](https://www.tebra.com/) (formerly Kareo) practice management. Exposes patient data, encounters, authorizations, appointments, charges, eligibility, and procedure codes to Claude and other MCP-compatible AI agents.

## Quick Start

```bash
npx tebra-mcp-server
```

## Prerequisites

- Node.js 18+
- Tebra SOAP API credentials (generated in Tebra PM admin under Settings > API)

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TEBRA_SOAP_USER` | Yes | SOAP API user (email) |
| `TEBRA_SOAP_PASSWORD` | Yes | SOAP API password |
| `TEBRA_CUSTOMER_KEY` | Yes | Customer key from Tebra PM admin |
| `TEBRA_SOAP_ENDPOINT` | No | Override SOAP endpoint (for testing) |

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
        "TEBRA_CUSTOMER_KEY": "your-customer-key"
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

## Available Tools

| Tool | Description |
|---|---|
| `tebra_search_patients` | Search patients by name, DOB, MRN, or external ID |
| `tebra_get_patient` | Get full patient record with insurance and authorizations |
| `tebra_get_patient_authorizations` | Get all authorizations across cases with status and remaining visits |
| `tebra_get_encounter` | Get encounter details with linked charges and procedures |
| `tebra_create_encounter` | Create a new encounter (superbill) with diagnoses and procedures |
| `tebra_get_appointments` | Get appointments within a date range, optionally by provider |
| `tebra_check_insurance_eligibility` | Check insurance eligibility based on on-file data |
| `tebra_get_charges` | Get charges with payment status, filterable by date and patient |
| `tebra_get_procedure_codes` | Get practice procedure codes with fees |

## API Reference

The server wraps the Tebra/Kareo SOAP API v2.1:
- Endpoint: `https://webservice.kareo.com/services/soap/2.1/KareoServices.svc`
- Auth: RequestHeader with User, Password, CustomerKey
- All requests include retry with exponential backoff (3 attempts)

## Development

```bash
git clone https://github.com/jamesrosing/tebra-mcp-server.git
cd tebra-mcp-server
npm install
npm run dev  # Uses tsx for direct TypeScript execution
```

## License

MIT
