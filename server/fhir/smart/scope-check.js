'use strict';

/**
 * SMART Scope Enforcement Middleware
 *
 * Inspects the authenticated user's token for SMART scope claims.
 * If the token carries a `scope` claim, enforces it against the
 * required scope for the requested FHIR resource.
 *
 * Backward compatibility:
 *   - Tokens without a `scope` claim pass through (pre-SMART clients).
 *   - Dev mode fallback users (no JWT) pass through.
 *
 * Denied requests are logged to audit_log with action 'smart_scope_denied'.
 */

const db = require('../../database');
const { RESOURCE_SCOPE_MAP, scopeSatisfies } = require('./smart-config');

/**
 * Extract the FHIR resource type from a FHIR router path.
 * Handles: /Patient/:id, /Patient, /Bundle, /metadata, etc.
 *
 * @param {string} path - req.path within the FHIR router (e.g. "/Patient/1")
 * @returns {string} resource type (e.g. "Patient") or "unknown"
 */
function extractResourceType(path) {
  // Strip leading slash and take first segment
  const seg = path.replace(/^\//, '').split('/')[0];
  return seg || 'unknown';
}

/**
 * Build the scope map key for a resource + method.
 * e.g. resource "Patient", method "GET" → "Patient.GET"
 */
function scopeKey(resourceType, method) {
  return `${resourceType}.${method.toUpperCase()}`;
}

/**
 * Log a scope denial to audit_log (fire-and-forget; errors are swallowed).
 */
async function logScopeDenial(req, resourceType, requiredScope, grantedScopes) {
  try {
    await db.dbRun(`
      INSERT INTO audit_log (
        user_identity, user_role, action, resource_type,
        description, request_method, request_path, response_status, phi_accessed
      ) VALUES (?, ?, 'smart_scope_denied', ?, ?, ?, ?, 403, 0)
    `, [
      req.user?.username || 'anonymous',
      req.user?.role || 'unknown',
      resourceType,
      `Required scope '${requiredScope}' not in granted [${grantedScopes.join(' ')}]`,
      req.method,
      req.originalUrl,
    ]);
  } catch (_) { /* audit failure must not block the response */ }
}

/**
 * SMART scope-check middleware.
 * Mount this on the FHIR router AFTER auth.requireAuth.
 */
function smartScopeCheck(req, res, next) {
  const user = req.user;

  // No user or no scope claim → backward-compat passthrough
  if (!user || !user.scope) return next();

  const grantedScopes = typeof user.scope === 'string'
    ? user.scope.split(' ').filter(Boolean)
    : (Array.isArray(user.scope) ? user.scope : []);

  const resourceType = extractResourceType(req.path);
  const key = scopeKey(resourceType, req.method);
  const requiredScope = RESOURCE_SCOPE_MAP[key] ?? RESOURCE_SCOPE_MAP[`${resourceType}.GET`] ?? null;

  if (requiredScope === null) return next(); // public or unmapped endpoint

  if (scopeSatisfies(grantedScopes, requiredScope)) return next();

  // Scope denied
  logScopeDenial(req, resourceType, requiredScope, grantedScopes);
  return res.status(403).json({
    resourceType: 'OperationOutcome',
    issue: [{
      severity: 'error',
      code: 'forbidden',
      diagnostics: `Insufficient scope. Required: ${requiredScope}`,
    }],
  });
}

module.exports = { smartScopeCheck, extractResourceType, scopeKey };
