/**
 * Startup behaviour of the FHIR configuration under Claude Desktop.
 *
 * Verified live 2026-09-19 against Claude Desktop's .mcpb install: an optional
 * user_config field the user leaves blank is passed through as the LITERAL
 * placeholder string "${user_config.<key>}", and a private key path that cannot
 * be read must not take the whole server down, because the desktop's built-in
 * Node mode does not surface the process's stderr anywhere the user can see.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { isFhirConfigured, loadFhirConfigOrDisable } from '../fhir-client.js';

const FHIR_VARS = [
  'TEBRA_FHIR_CLIENT_ID',
  'TEBRA_FHIR_PRIVATE_KEY_PATH',
  'TEBRA_FHIR_KID',
  'TEBRA_FHIR_CLIENT_SECRET',
] as const;

describe('FHIR startup configuration', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const v of FHIR_VARS) { saved[v] = process.env[v]; delete process.env[v]; }
  });
  afterEach(() => {
    for (const v of FHIR_VARS) {
      if (saved[v] === undefined) delete process.env[v]; else process.env[v] = saved[v];
    }
  });

  it('treats unexpanded ${user_config.*} placeholders as unset', () => {
    process.env.TEBRA_FHIR_CLIENT_ID = '${user_config.tebra_fhir_client_id}';
    process.env.TEBRA_FHIR_PRIVATE_KEY_PATH = '${user_config.tebra_fhir_private_key_path}';
    process.env.TEBRA_FHIR_KID = '${user_config.tebra_fhir_kid}';
    process.env.TEBRA_FHIR_CLIENT_SECRET = '${user_config.tebra_fhir_client_secret}';
    assert.equal(isFhirConfigured(), false);
    assert.equal(loadFhirConfigOrDisable(), null);
  });

  it('ignores a placeholder client secret when a real key path is configured', () => {
    process.env.TEBRA_FHIR_CLIENT_ID = 'client-1';
    process.env.TEBRA_FHIR_PRIVATE_KEY_PATH = '';
    process.env.TEBRA_FHIR_CLIENT_SECRET = '${user_config.tebra_fhir_client_secret}';
    assert.equal(isFhirConfigured(), false);
  });

  it('disables FHIR with a stderr message instead of throwing when the key cannot be read', () => {
    process.env.TEBRA_FHIR_CLIENT_ID = 'client-1';
    process.env.TEBRA_FHIR_PRIVATE_KEY_PATH = 'data/keys/does-not-exist.pem';
    process.env.TEBRA_FHIR_KID = 'kid-1';
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
    try {
      assert.equal(loadFhirConfigOrDisable(), null);
    } finally {
      console.error = originalError;
    }
    assert.ok(logged.some((l) => l.includes('does-not-exist.pem')), `expected the path in stderr, got: ${logged.join('\n')}`);
  });
});
