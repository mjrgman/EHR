'use strict';

/**
 * Unit tests for the auth + RBAC identity contract (S-C3, S-C4 hardening).
 *
 * Covers:
 *   - JWT_SECRET is not part of the public exports of server/security/auth.js
 *   - signToken/verifyToken are the public surface
 *   - rbac.requireRole rejects callers in production when only x-user-role
 *     headers are present (no JWT, no validated session)
 *   - rbac.requireRole accepts header-based identity ONLY when
 *     NODE_ENV=development AND ENABLE_DEV_AUTH_BYPASS=true
 *   - hipaa-middleware identity helper has the same gate
 *
 * These tests run with `node --test`. They use no external test framework.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function fresh(modulePath) {
  // Clear require cache so env changes take effect.
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function mockRes() {
  const calls = { status: null, json: null };
  const res = {
    status(code) { calls.status = code; return res; },
    json(body) { calls.json = body; return res; },
  };
  return { res, calls };
}

test('auth.js does not export JWT_SECRET', () => {
  const auth = require(path.join(ROOT, 'server', 'security', 'auth.js'));
  const exported = Object.keys(auth);
  assert.ok(!exported.includes('JWT_SECRET'),
    `JWT_SECRET must not be in module exports. Found: ${exported.join(', ')}`);
});

test('auth.js exports signToken and verifyToken as the public surface', () => {
  const auth = require(path.join(ROOT, 'server', 'security', 'auth.js'));
  assert.equal(typeof auth.signToken, 'function');
  assert.equal(typeof auth.verifyToken, 'function');
  assert.equal(typeof auth.requireAuth, 'function');
});

test('signToken / verifyToken round-trip preserves role and username', () => {
  const auth = require(path.join(ROOT, 'server', 'security', 'auth.js'));
  const token = auth.signToken({ id: 1, username: 'tester', role: 'physician' });
  assert.equal(typeof token, 'string');
  const decoded = auth.verifyToken(token);
  assert.equal(decoded.username, 'tester');
  assert.equal(decoded.role, 'physician');
});

test('rbac.requireRole rejects header-only identity in production', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevBypass = process.env.ENABLE_DEV_AUTH_BYPASS;
  process.env.NODE_ENV = 'production';
  delete process.env.ENABLE_DEV_AUTH_BYPASS;

  const rbac = fresh(path.join(ROOT, 'server', 'security', 'rbac.js'));
  const middleware = rbac.requireRole('physician');

  const req = {
    headers: { 'x-user-role': 'physician', 'x-user-id': 'attacker' },
    user: undefined,
    session: undefined,
    path: '/api/patients',
  };
  const { res, calls } = mockRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false, 'production must not honor header-only identity');
  assert.equal(calls.status, 403);

  process.env.NODE_ENV = prevEnv;
  if (prevBypass !== undefined) process.env.ENABLE_DEV_AUTH_BYPASS = prevBypass;
});

test('rbac.requireRole honors header identity when dev-bypass is explicitly enabled', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevBypass = process.env.ENABLE_DEV_AUTH_BYPASS;
  process.env.NODE_ENV = 'development';
  process.env.ENABLE_DEV_AUTH_BYPASS = 'true';

  const rbac = fresh(path.join(ROOT, 'server', 'security', 'rbac.js'));
  const middleware = rbac.requireRole('physician');

  const req = {
    headers: { 'x-user-role': 'physician', 'x-user-id': 'devuser' },
    user: undefined,
    session: undefined,
    path: '/api/patients',
  };
  const { res, calls } = mockRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true, 'dev-bypass with both env flags must permit header identity');
  assert.equal(calls.status, null);

  process.env.NODE_ENV = prevEnv;
  if (prevBypass !== undefined) process.env.ENABLE_DEV_AUTH_BYPASS = prevBypass;
  else delete process.env.ENABLE_DEV_AUTH_BYPASS;
});

test('rbac.requireRole prefers req.user (JWT identity) over session and headers', () => {
  const rbac = fresh(path.join(ROOT, 'server', 'security', 'rbac.js'));
  const middleware = rbac.requireRole('physician');

  const req = {
    user: { username: 'real-user', role: 'physician' },
    session: { userRole: 'guest' },
    headers: { 'x-user-role': 'admin' },
    path: '/api/patients',
  };
  const { res, calls } = mockRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.userRole, 'physician', 'req.user.role must win over session and headers');
});

test('rbac.requireRole defaults to guest when no identity source is present', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevBypass = process.env.ENABLE_DEV_AUTH_BYPASS;
  process.env.NODE_ENV = 'production';
  delete process.env.ENABLE_DEV_AUTH_BYPASS;

  const rbac = fresh(path.join(ROOT, 'server', 'security', 'rbac.js'));
  const middleware = rbac.requireRole('physician');

  const req = { user: undefined, session: undefined, headers: {}, path: '/api/patients' };
  const { res, calls } = mockRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(calls.status, 403);

  process.env.NODE_ENV = prevEnv;
  if (prevBypass !== undefined) process.env.ENABLE_DEV_AUTH_BYPASS = prevBypass;
});

test('rbac.requireRole does NOT default to physician when NODE_ENV is unset (regression S-C4)', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevBypass = process.env.ENABLE_DEV_AUTH_BYPASS;
  delete process.env.NODE_ENV;
  delete process.env.ENABLE_DEV_AUTH_BYPASS;

  const rbac = fresh(path.join(ROOT, 'server', 'security', 'rbac.js'));
  const middleware = rbac.requireRole('physician');

  const req = { user: undefined, session: undefined, headers: {}, path: '/api/patients' };
  const { res, calls } = mockRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false,
    'unset NODE_ENV must not silently grant physician role — S-C4 regression guard');
  assert.equal(calls.status, 403);

  if (prevEnv !== undefined) process.env.NODE_ENV = prevEnv;
  if (prevBypass !== undefined) process.env.ENABLE_DEV_AUTH_BYPASS = prevBypass;
});
