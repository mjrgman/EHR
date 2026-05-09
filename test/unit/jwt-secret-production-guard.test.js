'use strict';

/**
 * Regression guard for the JWT_SECRET production startup gate.
 *
 * Contract: when NODE_ENV=production, server/security/auth.js must throw at
 * module load if process.env.JWT_SECRET is unset. The previous behavior —
 * silently falling back to crypto.randomBytes(64) — would issue tokens that
 * invalidate on every server restart, logging every authenticated user out
 * simultaneously. That's a P0 production bug and a HIPAA §164.312(d)
 * "emergency access termination" violation in the wrong direction.
 *
 * Outside production we keep the ephemeral fallback so dev / test workflows
 * don't need to set a secret by hand. The warning still prints.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const AUTH_PATH = path.resolve(__dirname, '..', '..', 'server', 'security', 'auth.js');

function freshLoadAuth() {
  delete require.cache[require.resolve(AUTH_PATH)];
  return require(AUTH_PATH);
}

test('auth.js throws on load when NODE_ENV=production and JWT_SECRET is unset', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'production';
  delete process.env.JWT_SECRET;

  let threw = false;
  let message = '';
  try {
    freshLoadAuth();
  } catch (err) {
    threw = true;
    message = err.message || String(err);
  }

  if (prevEnv !== undefined) process.env.NODE_ENV = prevEnv;
  else delete process.env.NODE_ENV;
  if (prevSecret !== undefined) process.env.JWT_SECRET = prevSecret;

  // Re-load the module with valid env so other tests don't see the broken state
  delete require.cache[require.resolve(AUTH_PATH)];
  if (process.env.NODE_ENV !== 'production' || process.env.JWT_SECRET) {
    require(AUTH_PATH);
  }

  assert.equal(threw, true, 'auth.js must throw at load when production lacks JWT_SECRET');
  assert.match(message, /JWT_SECRET/i);
  assert.match(message, /production/i);
});

test('auth.js loads cleanly outside production with no JWT_SECRET (ephemeral fallback allowed)', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'development';
  delete process.env.JWT_SECRET;

  let threw = false;
  try {
    freshLoadAuth();
  } catch (err) {
    threw = true;
  }

  if (prevEnv !== undefined) process.env.NODE_ENV = prevEnv;
  else delete process.env.NODE_ENV;
  if (prevSecret !== undefined) process.env.JWT_SECRET = prevSecret;

  // Refresh cache for downstream tests
  delete require.cache[require.resolve(AUTH_PATH)];

  assert.equal(threw, false, 'dev / test workflows must still load auth without JWT_SECRET');
});

test('auth.js loads cleanly in production when JWT_SECRET is set', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'a'.repeat(64);

  let threw = false;
  try {
    freshLoadAuth();
  } catch (err) {
    threw = true;
  }

  if (prevEnv !== undefined) process.env.NODE_ENV = prevEnv;
  else delete process.env.NODE_ENV;
  if (prevSecret !== undefined) process.env.JWT_SECRET = prevSecret;
  else delete process.env.JWT_SECRET;

  delete require.cache[require.resolve(AUTH_PATH)];

  assert.equal(threw, false, 'production must load successfully when JWT_SECRET is set');
});
