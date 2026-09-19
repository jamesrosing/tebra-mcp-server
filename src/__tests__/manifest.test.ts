/**
 * Pins the MCP Bundle manifest (manifest.json) against package.json and the
 * tool registry so the desktop-extension packaging cannot drift from the
 * server it ships. Connectors Directory submission requires manifest_version
 * 0.2+, an HTTPS privacy_policies array, and sensitive user_config for
 * every credential.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { allSoapTools, allFhirTools } from '../tool-registry.js';

const root = new URL('../../', import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, root), 'utf8');

interface Manifest {
  manifest_version: string;
  name: string;
  version: string;
  description: string;
  server: { type: string; entry_point: string; mcp_config: { command: string; args: string[]; env: Record<string, string> } };
  tools: Array<{ name: string; description: string }>;
  privacy_policies: string[];
  user_config: Record<string, { type: string; required?: boolean; sensitive?: boolean }>;
}

const pkg = JSON.parse(read('package.json')) as { name: string; version: string; description: string };
const manifest = JSON.parse(read('manifest.json')) as Manifest;

test('manifest.json is a 0.2+ MCPB manifest that matches package.json', () => {
  assert.match(manifest.manifest_version, /^0\.[2-9]|^[1-9]/);
  assert.equal(manifest.name, pkg.name);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.server.type, 'node');
  assert.equal(manifest.server.entry_point, 'dist/index.js');
  assert.ok(manifest.server.mcp_config.args.some((a) => a.includes('dist/index.js')));
});

test('manifest.json lists every registered tool by name with a description', () => {
  const registered = [...allSoapTools, ...allFhirTools].map((t) => t.name).sort();
  const listed = manifest.tools.map((t) => t.name).sort();
  assert.deepEqual(listed, registered);
  for (const tool of manifest.tools) assert.ok(tool.description.length > 0, tool.name);
});

test('manifest.json declares an HTTPS privacy policy and a README Privacy Policy section', () => {
  assert.ok(Array.isArray(manifest.privacy_policies) && manifest.privacy_policies.length > 0);
  for (const url of manifest.privacy_policies) assert.match(url, /^https:\/\//);
  assert.ok(existsSync(new URL('PRIVACY.md', root)), 'PRIVACY.md missing');
  assert.match(read('README.md'), /^## Privacy Policy$/m);
});

test('manifest.json marks every credential as sensitive user_config and maps it into env', () => {
  const credentials = ['TEBRA_SOAP_USER', 'TEBRA_SOAP_PASSWORD', 'TEBRA_CUSTOMER_KEY',
    'TEBRA_FHIR_CLIENT_ID', 'TEBRA_FHIR_CLIENT_SECRET', 'TEBRA_FHIR_KID'];
  for (const name of credentials) {
    const key = name.toLowerCase();
    assert.ok(manifest.user_config[key], `user_config.${key} missing`);
    assert.equal(manifest.user_config[key].sensitive, true, `${key} not sensitive`);
    assert.equal(manifest.server.mcp_config.env[name], `\${user_config.${key}}`);
  }
  assert.equal(manifest.user_config.tebra_fhir_private_key_path?.type, 'file');
  for (const name of ['TEBRA_SOAP_USER', 'TEBRA_SOAP_PASSWORD', 'TEBRA_CUSTOMER_KEY']) {
    assert.equal(manifest.user_config[name.toLowerCase()].required, true, `${name} not required`);
  }
});

test('README, package.json, and the skill state independence from Tebra and the BAA requirement', () => {
  const readme = read('README.md');
  assert.match(readme, /not affiliated with, endorsed by, or supported by Tebra/);
  assert.match(readme, /Business Associate Agreement/);
  assert.match(pkg.description, /[Ii]ndependent/);
  assert.match(pkg.description, /not affiliated with Tebra/);
  assert.match(read('skills/tebra/SKILL.md'), /Business Associate Agreement/);
});
