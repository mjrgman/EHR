'use strict';

/**
 * SMART-on-FHIR Token Endpoint
 * POST /smart/token
 *
 * Supported grant types:
 *   client_credentials — system-to-system; client authenticates with
 *                        Basic auth (username:password) or JSON body.
 *   password           — resource owner password; for integration testing.
 *                        Not recommended for production SMART apps.
 *
 * Both grants validate credentials against the users table and issue a
 * JWT carrying SMART scope claims derived from the user's role.
 *
 * Audit trail: every token issuance is logged to audit_log.
 */

const auth = require('../../security/auth');
const db = require('../../database');
const { ROLE_SCOPES, ALL_SCOPES, scopeSatisfies } = require('./smart-config');

// ──────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────

/**
 * Parse Basic auth header → { username, password } or null.
 */
function parseBasicAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon < 0) return null;
    return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
  } catch {
    return null;
  }
}

/**
 * Intersect requested scopes with what the role is allowed.
 * If no scope requested, return full role defaults.
 */
function resolveScopes(requestedScope, role) {
  const defaults = ROLE_SCOPES[role] || ['openid'];
  if (!requestedScope) return defaults;

  const requested = requestedScope.split(' ').filter(Boolean);
  // Only grant scopes that are in ALL_SCOPES AND satisfiable by role defaults
  return requested.filter(r =>
    ALL_SCOPES.includes(r) && defaults.some(d => scopeSatisfies([d], r))
  );
}

/**
 * Authenticate user and return user row, or throw with { status, error }.
 */
async function authenticate(username, password) {
  if (!username || !password) {
    throw Object.assign(new Error('Missing credentials'), { status: 400, error: 'invalid_request' });
  }
  const user = await db.dbGet(
    'SELECT * FROM users WHERE username = ? AND is_active = 1',
    [username]
  );
  if (!user) {
    throw Object.assign(new Error('Invalid credentials'), { status: 401, error: 'invalid_client' });
  }
  const bcrypt = require('bcryptjs');
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw Object.assign(new Error('Invalid credentials'), { status: 401, error: 'invalid_client' });
  }
  return user;
}

/**
 * Log token issuance to audit_log (fire-and-forget).
 */
async function logTokenIssued(user, grantType, scopes, ip) {
  try {
    await db.dbRun(`
      INSERT INTO audit_log (
        user_identity, user_role, action, resource_type,
        description, request_method, request_path, response_status, phi_accessed
      ) VALUES (?, ?, 'smart_token_issued', 'Token', ?, 'POST', '/smart/token', 200, 0)
    `, [
      user.username,
      user.role,
      `grant_type=${grantType} scopes=[${scopes.join(' ')}]`,
    ]);
  } catch (_) { /* audit failure must not block token response */ }
}

/**
 * Log token denial to audit_log (fire-and-forget).
 */
async function logTokenDenied(username, reason, ip) {
  try {
    await db.dbRun(`
      INSERT INTO audit_log (
        user_identity, action, resource_type,
        description, request_method, request_path, response_status, phi_accessed
      ) VALUES (?, 'smart_token_denied', 'Token', ?, 'POST', '/smart/token', 401, 0)
    `, [username || 'unknown', reason]);
  } catch (_) {}
}

// ──────────────────────────────────────────
// ROUTE HANDLER
// ──────────────────────────────────────────

/**
 * POST /smart/token
 *
 * Request (application/x-www-form-urlencoded or JSON):
 *   grant_type   required  'client_credentials' | 'password'
 *   scope        optional  space-separated SMART scopes
 *   username     required for password grant (or via Basic auth)
 *   password     required for password grant (or via Basic auth)
 *
 * Response:
 *   { access_token, token_type, expires_in, scope }
 */
async function tokenHandler(req, res) {
  const body = req.body || {};
  const grantType = body.grant_type;
  const ip = req.ip;

  if (!['client_credentials', 'password'].includes(grantType)) {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Supported grant types: client_credentials, password',
    });
  }

  let username, password;

  // Prefer Basic auth header; fall back to body fields
  const basic = parseBasicAuth(req.headers['authorization']);
  if (basic) {
    username = basic.username;
    password = basic.password;
  } else {
    username = body.username;
    password = body.password;
  }

  let user;
  try {
    user = await authenticate(username, password);
  } catch (err) {
    await logTokenDenied(username, err.message, ip);
    return res.status(err.status || 401).json({
      error: err.error || 'invalid_client',
      error_description: err.message,
    });
  }

  const grantedScopes = resolveScopes(body.scope, user.role);
  const scopeString = grantedScopes.join(' ');

  // Issue JWT with scope claim embedded
  const jwt = require('jsonwebtoken');
  const expiresIn = 3600; // 1 hour
  const token = jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
      scope: scopeString,
    },
    auth.JWT_SECRET,
    { expiresIn }
  );

  // Update last_login
  await db.dbRun('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
  await logTokenIssued(user, grantType, grantedScopes, ip);

  res.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: scopeString,
  });
}

/**
 * GET /smart/introspect (stub — returns token metadata)
 * POST /smart/introspect
 */
async function introspectHandler(req, res) {
  const body = req.body || {};
  const token = body.token || req.query.token;
  if (!token) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'token required' });
  }
  const decoded = auth.verifyToken(token);
  if (!decoded) {
    return res.json({ active: false });
  }
  res.json({
    active: true,
    sub: decoded.sub,
    username: decoded.username,
    role: decoded.role,
    scope: decoded.scope || '',
    exp: decoded.exp,
    iat: decoded.iat,
  });
}

/**
 * GET /smart/authorize (stub — redirects to login UI)
 * A full authorization_code flow requires a UI; this stub returns
 * a 302 to the existing login page with the request params preserved.
 */
function authorizeHandler(req, res) {
  // In production this would render a consent screen.
  // For now, redirect to the SPA login with the SMART params as query.
  const params = new URLSearchParams(req.query).toString();
  res.redirect(302, `/?smart_launch=1&${params}`);
}

/**
 * GET /smart/launch — EHR-initiated launch context handler
 * Records the launch context (patient, encounter, intent) and returns
 * a launch token for use with the authorization code flow.
 */
async function launchHandler(req, res) {
  const { patient, encounter, intent } = req.query;
  const user = req.user;

  // Log the launch event
  try {
    await db.dbRun(`
      INSERT INTO audit_log (
        user_identity, user_role, action, resource_type,
        description, request_method, request_path, response_status,
        phi_accessed, patient_id
      ) VALUES (?, ?, 'smart_launch', 'Launch', ?, 'GET', '/smart/launch', 200, ?, ?)
    `, [
      user?.username || 'anonymous',
      user?.role || 'unknown',
      `intent=${intent || 'none'} patient=${patient || 'none'} encounter=${encounter || 'none'}`,
      patient ? 1 : 0,
      patient ? parseInt(patient, 10) : null,
    ]);
  } catch (_) {}

  // Return launch context as JSON (client uses this to start authorize flow)
  res.json({
    launch: {
      patient: patient || null,
      encounter: encounter || null,
      intent: intent || null,
    },
    authorize_url: `${req.protocol}://${req.get('host')}/smart/authorize`,
  });
}

module.exports = { tokenHandler, introspectHandler, authorizeHandler, launchHandler };
