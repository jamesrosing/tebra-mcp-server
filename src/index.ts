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
import { patientTools, handlePatientTool } from './tools/patients.js';
import { encounterTools, handleEncounterTool } from './tools/encounters.js';
import { authorizationTools, handleAuthorizationTool } from './tools/authorizations.js';
import { appointmentTools, handleAppointmentTool } from './tools/appointments.js';
import { eligibilityTools, handleEligibilityTool } from './tools/eligibility.js';
import { chargeTools, handleChargeTool } from './tools/charges.js';
import { procedureCodeTools, handleProcedureCodeTool } from './tools/procedure-codes.js';

// ─── Validate config on startup ─────────────────────────────────

const config = getConfig();

// ─── Create MCP Server ──────────────────────────────────────────

const server = new Server(
  {
    name: '@allure-md/tebra-mcp-server',
    version: '0.1.0',
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
];

// ─── Tool Listing ───────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: allTools };
});

// ─── Tool Execution ─────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Route to the correct handler by exact tool name
    const safeArgs = args ?? {};

    switch (name) {
      case 'tebra_search_patients':
      case 'tebra_get_patient':
        return await handlePatientTool(name, safeArgs, config);

      case 'tebra_get_patient_authorizations':
        return await handleAuthorizationTool(name, safeArgs, config);

      case 'tebra_get_encounter':
      case 'tebra_create_encounter':
        return await handleEncounterTool(name, safeArgs, config);

      case 'tebra_get_appointments':
        return await handleAppointmentTool(name, safeArgs, config);

      case 'tebra_check_insurance_eligibility':
        return await handleEligibilityTool(name, safeArgs, config);

      case 'tebra_get_charges':
        return await handleChargeTool(name, safeArgs, config);

      case 'tebra_get_procedure_codes':
        return await handleProcedureCodeTool(name, safeArgs, config);

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
  // Server is now running and listening on stdio
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Tebra MCP server failed to start:', error);
  process.exit(1);
});
