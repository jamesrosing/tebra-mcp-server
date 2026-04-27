/**
 * FHIR Device — patient-associated implantable / wearable devices.
 */

import {
  fhirRequest,
  getFhirConfig,
  extractBundleResources,
  formatFhirResult,
  codeDisplay,
  refDisplay,
  type FhirResource,
} from './helpers.js';

export const fhirDeviceTools = [
  {
    name: 'tebra_fhir_get_devices',
    description:
      'Get patient-associated devices from Tebra FHIR API. Returns device type, manufacturer, model, and UDI.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'string',
          description: 'Tebra FHIR patient ID',
        },
      },
      required: ['patientId'],
    },
  },
];

function summarize(r: FhirResource): Record<string, unknown> {
  return {
    id: r.id,
    type: codeDisplay(r.type),
    status: r.status,
    manufacturer: r.manufacturer,
    model: r.modelNumber,
    serialNumber: r.serialNumber,
    patient: refDisplay(r.patient),
    udiCarrier: Array.isArray(r.udiCarrier)
      ? (r.udiCarrier as Array<{ deviceIdentifier?: string }>).map((u) => u.deviceIdentifier)
      : [],
  };
}

export async function handleFhirDeviceTool(
  _name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const config = getFhirConfig();
  const patientId = String(args.patientId ?? '');
  if (!patientId) return { content: [{ type: 'text', text: 'patientId is required.' }] };

  const data = await fhirRequest(config, 'Device', { patient: patientId });
  const resources = extractBundleResources(data);
  return formatFhirResult(resources, 'devices', summarize);
}
