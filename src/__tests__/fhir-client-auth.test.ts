/**
 * SMART Backend Services client authentication (private_key_jwt) for the
 * FHIR token endpoint — offline only. Nothing here talks to Tebra: the token
 * endpoint is a mocked fetch, and the assertion is verified against a
 * committed copy of the PUBLIC key set published at
 * https://allure-md.com/.well-known/jwks.json (public material, no secret).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildClientAssertion,
  CLIENT_ASSERTION_TYPE,
  fhirRequest,
  getFhirConfig,
  isFhirConfigured,
  type FhirConfig,
} from '../fhir-client.js';

const PUBLISHED_JWKS = JSON.parse(
  readFileSync(new URL('./fixtures/allure-md-jwks.json', import.meta.url), 'utf8'),
) as { keys: Array<{ kty: string; n: string; e: string; kid: string; alg: string }> };

const TOKEN_URL = 'https://fhir.example.test/smartauth/oauth/token';
const CLIENT_ID = '79497b76-0000-0000-0000-000000000000';

function b64urlJson(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function thumbprint(n: string, e: string): string {
  return createHash('sha256').update(JSON.stringify({ e, kty: 'RSA', n }), 'utf8').digest('base64url');
}

function verifyAgainstJwk(jwt: string, jwk: { kty: string; n: string; e: string }): boolean {
  const [h, p, s] = jwt.split('.');
  const key = createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
  return cryptoVerify('sha384', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
}

function testKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string };
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    jwk,
    kid: thumbprint(jwk.n, jwk.e),
  };
}

describe('buildClientAssertion (SMART Backend Services private_key_jwt)', () => {
  it('signs an RS384 JWT whose header carries the kid and whose claims are iss=sub=client, aud=token URL, exp=iat+5min, jti', () => {
    const { privatePem, jwk, kid } = testKeyPair();
    const now = 1_800_000_000;
    const jwt = buildClientAssertion({ clientId: CLIENT_ID, tokenUrl: TOKEN_URL, privateKeyPem: privatePem, kid, now });

    const [h, p] = jwt.split('.');
    assert.deepEqual(b64urlJson(h), { alg: 'RS384', typ: 'JWT', kid });
    const claims = b64urlJson(p);
    assert.equal(claims.iss, CLIENT_ID);
    assert.equal(claims.sub, CLIENT_ID);
    assert.equal(claims.aud, TOKEN_URL);
    assert.equal(claims.iat, now);
    assert.equal(claims.exp, now + 300);
    assert.equal(typeof claims.jti, 'string');
    assert.ok((claims.jti as string).length >= 16);
    assert.ok(verifyAgainstJwk(jwt, jwk), 'signature must verify with the matching public JWK');
  });

  it('mints a distinct jti on every call', () => {
    const { privatePem, kid } = testKeyPair();
    const a = buildClientAssertion({ clientId: CLIENT_ID, tokenUrl: TOKEN_URL, privateKeyPem: privatePem, kid });
    const b = buildClientAssertion({ clientId: CLIENT_ID, tokenUrl: TOKEN_URL, privateKeyPem: privatePem, kid });
    assert.notEqual(b64urlJson(a.split('.')[1]).jti, b64urlJson(b.split('.')[1]).jti);
  });

  it('does not verify under a different key (the signature is real, not a placeholder)', () => {
    const { privatePem, kid } = testKeyPair();
    const other = testKeyPair();
    const jwt = buildClientAssertion({ clientId: CLIENT_ID, tokenUrl: TOKEN_URL, privateKeyPem: privatePem, kid });
    assert.equal(verifyAgainstJwk(jwt, other.jwk), false);
  });

  it('verifies against the PUBLISHED allure-md.com JWKS when the operator key is on this machine', (t) => {
    const keyPath = process.env.TEBRA_FHIR_PRIVATE_KEY_PATH;
    if (!keyPath || !existsSync(keyPath)) {
      t.skip('TEBRA_FHIR_PRIVATE_KEY_PATH not set or file absent — public-JWKS verification skipped');
      return;
    }
    const published = PUBLISHED_JWKS.keys[0];
    assert.equal(published.alg, 'RS384');
    assert.equal(published.kid, thumbprint(published.n, published.e), 'published kid is the RFC 7638 thumbprint');
    const jwt = buildClientAssertion({
      clientId: CLIENT_ID,
      tokenUrl: TOKEN_URL,
      privateKeyPem: readFileSync(keyPath, 'utf8'),
      kid: published.kid,
    });
    assert.equal(b64urlJson(jwt.split('.')[0]).kid, published.kid);
    assert.ok(verifyAgainstJwk(jwt, published), 'assertion must verify against the published public key');
  });
});

describe('token request: private_key_jwt vs client_secret', () => {
  let originalFetch: typeof fetch;
  let bodies: URLSearchParams[];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    bodies = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url === TOKEN_URL) {
        bodies.push(new URLSearchParams(String(init?.body)));
        // expires_in 0 so the module-level cache never serves a stale token across tests.
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify({ resourceType: 'Bundle', entry: [] }), { status: 200 });
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('sends client_assertion + client_assertion_type and NO client_secret when a private key is configured', async () => {
    const { privatePem, jwk, kid } = testKeyPair();
    const config: FhirConfig = {
      clientId: CLIENT_ID, baseUrl: 'https://fhir.example.test/fhir-request', tokenUrl: TOKEN_URL,
      privateKey: { pem: privatePem, kid },
    };
    await fhirRequest(config, 'Patient', { _count: '1' });
    assert.equal(bodies.length, 1);
    const body = bodies[0];
    assert.equal(body.get('grant_type'), 'client_credentials');
    assert.equal(body.get('client_assertion_type'), CLIENT_ASSERTION_TYPE);
    assert.equal(CLIENT_ASSERTION_TYPE, 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    assert.equal(body.has('client_secret'), false);
    const assertion = body.get('client_assertion');
    assert.ok(assertion);
    assert.ok(verifyAgainstJwk(assertion, jwk));
    assert.equal(b64urlJson(assertion.split('.')[1]).aud, TOKEN_URL);
  });

  it('falls back to client_secret when no private key is configured', async () => {
    const config: FhirConfig = {
      clientId: CLIENT_ID, clientSecret: 'shh', baseUrl: 'https://fhir.example.test/fhir-request', tokenUrl: TOKEN_URL,
    };
    await fhirRequest(config, 'Patient');
    const body = bodies[0];
    assert.equal(body.get('client_secret'), 'shh');
    assert.equal(body.has('client_assertion'), false);
  });

  it('signs a FRESH assertion for each token request (new jti)', async () => {
    const { privatePem, kid } = testKeyPair();
    const config: FhirConfig = {
      clientId: CLIENT_ID, baseUrl: 'https://fhir.example.test/fhir-request', tokenUrl: TOKEN_URL,
      privateKey: { pem: privatePem, kid },
    };
    await fhirRequest(config, 'Patient');
    await fhirRequest(config, 'Patient');
    assert.equal(bodies.length, 2);
    const jti = (i: number) => b64urlJson(bodies[i].get('client_assertion')!.split('.')[1]).jti;
    assert.notEqual(jti(0), jti(1));
  });
});

describe('getFhirConfig / isFhirConfigured with TEBRA_FHIR_PRIVATE_KEY_PATH', () => {
  const ENV = ['TEBRA_FHIR_CLIENT_ID', 'TEBRA_FHIR_CLIENT_SECRET', 'TEBRA_FHIR_PRIVATE_KEY_PATH', 'TEBRA_FHIR_KID'] as const;
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    for (const k of ENV) delete process.env[k];
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });

  function writeKey(): string {
    const dir = mkdtempSync(join(tmpdir(), 'fhir-key-'));
    const path = join(dir, 'k.pem');
    writeFileSync(path, testKeyPair().privatePem, { mode: 0o600 });
    return path;
  }

  it('reads the key from disk and the kid from TEBRA_FHIR_KID; no secret needed', () => {
    process.env.TEBRA_FHIR_CLIENT_ID = CLIENT_ID;
    process.env.TEBRA_FHIR_PRIVATE_KEY_PATH = writeKey();
    process.env.TEBRA_FHIR_KID = 'kid-1';
    assert.equal(isFhirConfigured(), true);
    const cfg = getFhirConfig();
    assert.equal(cfg.clientSecret, undefined);
    assert.equal(cfg.privateKey?.kid, 'kid-1');
    assert.match(cfg.privateKey?.pem ?? '', /BEGIN PRIVATE KEY/);
  });

  it('refuses a key path without TEBRA_FHIR_KID (an assertion with no kid cannot be matched to the JWKS)', () => {
    process.env.TEBRA_FHIR_CLIENT_ID = CLIENT_ID;
    process.env.TEBRA_FHIR_PRIVATE_KEY_PATH = writeKey();
    assert.throws(() => getFhirConfig(), /TEBRA_FHIR_KID/);
  });

  it('fails with context when the key file cannot be read', () => {
    process.env.TEBRA_FHIR_CLIENT_ID = CLIENT_ID;
    process.env.TEBRA_FHIR_PRIVATE_KEY_PATH = '/nonexistent/fhir.pem';
    process.env.TEBRA_FHIR_KID = 'kid-1';
    assert.throws(() => getFhirConfig(), /TEBRA_FHIR_PRIVATE_KEY_PATH.*\/nonexistent\/fhir\.pem/);
  });

  it('prefers the private key when BOTH a key path and a secret are set (the secret becomes inert)', () => {
    process.env.TEBRA_FHIR_CLIENT_ID = CLIENT_ID;
    process.env.TEBRA_FHIR_CLIENT_SECRET = 'legacy';
    process.env.TEBRA_FHIR_PRIVATE_KEY_PATH = writeKey();
    process.env.TEBRA_FHIR_KID = 'kid-1';
    const cfg = getFhirConfig();
    assert.equal(cfg.privateKey?.kid, 'kid-1');
    assert.equal(cfg.clientSecret, undefined);
  });

  it('still configures from client id + secret alone (existing installs keep working)', () => {
    process.env.TEBRA_FHIR_CLIENT_ID = CLIENT_ID;
    process.env.TEBRA_FHIR_CLIENT_SECRET = 'legacy';
    assert.equal(isFhirConfigured(), true);
    assert.equal(getFhirConfig().clientSecret, 'legacy');
  });

  it('is unconfigured with a client id and neither credential', () => {
    process.env.TEBRA_FHIR_CLIENT_ID = CLIENT_ID;
    assert.equal(isFhirConfigured(), false);
    assert.throws(() => getFhirConfig(), /TEBRA_FHIR_CLIENT_SECRET|TEBRA_FHIR_PRIVATE_KEY_PATH/);
  });
});
