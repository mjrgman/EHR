/**
 * LabCorp OAuth2 — pure helpers + token storage + network exchange (Phase 2b)
 *
 * Chunk 2 (pure / local):
 *   - generateState()           — CSRF-safe random state
 *   - buildAuthorizeUrl(opts)   — assemble /oauth/authorize URL
 *   - parseCallback(q, exp)     — validate callback query, extract code
 *   - storeTokens(db, uid, t)   — encrypt + upsert into labcorp_tokens
 *   - getTokens(db, uid)        — fetch + decrypt
 *   - deleteTokens(db, uid)     — remove row
 *
 * Chunk 3 (network exchange):
 *   - exchangeCodeForTokens()   — POST /oauth/token with authorization_code
 *   - refreshAccessToken()      — POST /oauth/token with refresh_token
 *
 * Why Chunk 2 and Chunk 3 stay in one file: they share the same OAuth2
 * protocol knowledge and the same surface (tokens in/out). The chunk
 * boundary was a staging discipline for TDD, not a module boundary.
 *
 * Encryption: tokens are stored as AES-256-GCM ciphertext via
 * server/security/phi-encryption.js. The module will throw at storeTokens
 * time if PHI_ENCRYPTION_KEY is missing — tests set it before calling.
 *
 * Table contract: `labcorp_tokens` has UNIQUE(user_id), so storeTokens uses
 * INSERT ... ON CONFLICT(user_id) DO UPDATE to maintain one row per user.
 * That constraint is asserted in the migration (database-migrations.js).
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const phiEncryption = require('../../security/phi-encryption');

const DEFAULT_TIMEOUT_MS = parseInt(process.env.LABCORP_TIMEOUT_MS || '30000', 10);

// ==========================================
// PURE HELPERS — no I/O, trivially testable
// ==========================================

/**
 * Generate a cryptographically-random CSRF state token.
 *
 * 32 random bytes → 64 hex chars. This is the payload that round-trips
 * through the OAuth2 authorize → callback flow; parseCallback() verifies
 * the returned state matches what we issued to defend against CSRF.
 *
 * @returns {string} 64-char lowercase hex
 */
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Build the LabCorp OAuth2 authorize URL.
 *
 * The caller supplies env-sourced values so this stays testable in isolation
 * (no process.env reads here). Phase 2c will wrap this with an env-reading
 * convenience at the client-construction layer.
 *
 * @param {Object} opts
 * @param {string} opts.authUrl     - Base /oauth/authorize endpoint
 * @param {string} opts.clientId    - OAuth2 client_id
 * @param {string} opts.redirectUri - Must match portal-registered redirect
 * @param {string} opts.state       - CSRF state from generateState()
 * @param {string} [opts.scope]     - Space-separated scopes (default 'read')
 * @returns {string} Fully-formed authorize URL with query params
 */
function buildAuthorizeUrl({ authUrl, clientId, redirectUri, scope, state } = {}) {
  if (!authUrl) throw new Error('buildAuthorizeUrl: authUrl is required');
  if (!clientId) throw new Error('buildAuthorizeUrl: clientId is required');
  if (!redirectUri) throw new Error('buildAuthorizeUrl: redirectUri is required');
  if (!state) throw new Error('buildAuthorizeUrl: state is required');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scope || 'read',
    state,
  });

  return `${authUrl}?${params.toString()}`;
}

/**
 * Parse and validate a LabCorp OAuth2 callback query.
 *
 * Three distinct failure modes, each surfaced as a thrown Error:
 *   1. `query.error` present → LabCorp denied or errored (access_denied, etc.)
 *   2. state missing or mismatched → potential CSRF attack
 *   3. code missing → malformed callback
 *
 * Throwing (rather than returning { ok: false }) is intentional: route
 * handlers treat these as unrecoverable for the current flow and surface
 * a 400/401 to the user. No retry makes sense for any of them.
 *
 * @param {Object} query - Express req.query
 * @param {string} expectedState - The state we issued earlier
 * @returns {{ code: string, state: string }}
 */
function parseCallback(query, expectedState) {
  if (!query || typeof query !== 'object') {
    throw new Error('parseCallback: query must be an object');
  }

  // LabCorp returned an OAuth2 error — surface it so routes can 400 cleanly
  if (query.error) {
    const desc = query.error_description || 'no description';
    throw new Error(`OAuth2 error from LabCorp: ${query.error} — ${desc}`);
  }

  if (!query.state) {
    throw new Error('parseCallback: state is missing from callback');
  }

  // Timing-safe state comparison to avoid leaking length via timing attacks
  // (cheap defense; state is random and high-entropy so the real protection
  //  is the equality check itself, but timing-safe is free and correct).
  if (!timingSafeEqualStr(query.state, expectedState)) {
    throw new Error('parseCallback: state mismatch (possible CSRF)');
  }

  if (!query.code) {
    throw new Error('parseCallback: authorization code is missing from callback');
  }

  return { code: query.code, state: query.state };
}

// ==========================================
// DB-BACKED TOKEN STORAGE (encrypted)
// ==========================================

/**
 * Store OAuth2 tokens for a user. Encrypts access + refresh tokens before
 * persistence and upserts by user_id (UNIQUE constraint in migration).
 *
 * Expected token shape mirrors RFC 6749 §5.1:
 *   { access_token, refresh_token, token_type, expires_in, scope }
 *
 * @param {Object} db - `server/database` wrapper (exposes dbRun/dbGet/dbAll)
 * @param {number} userId
 * @param {Object} tokens
 * @returns {Promise<void>}
 */
async function storeTokens(db, userId, tokens) {
  if (!db || typeof db.dbRun !== 'function') {
    throw new Error('storeTokens: db wrapper with dbRun() required');
  }
  if (!userId) throw new Error('storeTokens: userId is required');
  if (!tokens || !tokens.access_token || !tokens.refresh_token) {
    throw new Error('storeTokens: tokens.access_token and tokens.refresh_token are required');
  }

  const accessEncrypted = phiEncryption.encrypt(String(tokens.access_token));
  const refreshEncrypted = phiEncryption.encrypt(String(tokens.refresh_token));
  const expiresAt = new Date(Date.now() + (Number(tokens.expires_in) || 3600) * 1000).toISOString();
  const tokenType = tokens.token_type || 'Bearer';
  const scope = tokens.scope || null;

  // ON CONFLICT(user_id) upserts because UNIQUE(user_id) is enforced in the
  // migration. We refresh last_refresh_at on every store because both the
  // initial grant and subsequent refresh_token exchanges funnel through
  // here — distinguishing them isn't useful for the audit trail.
  const sql = `
    INSERT INTO labcorp_tokens (
      user_id, access_token_encrypted, refresh_token_encrypted,
      token_type, expires_at, scope, last_refresh_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      access_token_encrypted = excluded.access_token_encrypted,
      refresh_token_encrypted = excluded.refresh_token_encrypted,
      token_type = excluded.token_type,
      expires_at = excluded.expires_at,
      scope = excluded.scope,
      last_refresh_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `;

  await db.dbRun(sql, [
    userId,
    accessEncrypted,
    refreshEncrypted,
    tokenType,
    expiresAt,
    scope,
  ]);
}

/**
 * Fetch + decrypt a user's LabCorp tokens.
 *
 * @param {Object} db
 * @param {number} userId
 * @returns {Promise<Object|null>} Decrypted token record, or null if missing
 */
async function getTokens(db, userId) {
  if (!db || typeof db.dbGet !== 'function') {
    throw new Error('getTokens: db wrapper with dbGet() required');
  }
  if (!userId) throw new Error('getTokens: userId is required');

  const row = await db.dbGet(
    `SELECT id, user_id, access_token_encrypted, refresh_token_encrypted,
            token_type, expires_at, scope, created_at, updated_at, last_refresh_at
       FROM labcorp_tokens
      WHERE user_id = ?`,
    [userId]
  );

  if (!row) return null;

  return {
    id: row.id,
    user_id: row.user_id,
    access_token: phiEncryption.decrypt(row.access_token_encrypted),
    refresh_token: phiEncryption.decrypt(row.refresh_token_encrypted),
    token_type: row.token_type,
    expires_at: row.expires_at,
    scope: row.scope,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_refresh_at: row.last_refresh_at,
  };
}

/**
 * Remove a user's stored tokens (e.g. on disconnect or revocation).
 *
 * @param {Object} db
 * @param {number} userId
 * @returns {Promise<void>}
 */
async function deleteTokens(db, userId) {
  if (!db || typeof db.dbRun !== 'function') {
    throw new Error('deleteTokens: db wrapper with dbRun() required');
  }
  if (!userId) throw new Error('deleteTokens: userId is required');
  await db.dbRun('DELETE FROM labcorp_tokens WHERE user_id = ?', [userId]);
}

// ==========================================
// NETWORK EXCHANGE (Chunk 3)
// ==========================================

/**
 * Exchange an OAuth2 authorization code for access + refresh tokens.
 *
 * RFC 6749 §4.1.3: POST application/x-www-form-urlencoded to /oauth/token
 * with grant_type=authorization_code, code, redirect_uri, client_id,
 * client_secret. LabCorp accepts body-based credentials (not Basic Auth)
 * per their developer portal docs — this matches the 2b scaffold contract.
 *
 * @param {Object} opts
 * @param {string} opts.tokenUrl      - Full /oauth/token endpoint URL
 * @param {string} opts.clientId
 * @param {string} opts.clientSecret
 * @param {string} opts.code          - Authorization code from callback
 * @param {string} opts.redirectUri   - Must match authorize-time redirect
 * @param {number} [opts.timeoutMs]   - Override default 30s timeout
 * @returns {Promise<Object>} Token response: { access_token, refresh_token,
 *                            token_type, expires_in, scope }
 * @throws {Error} on non-2xx response, timeout, or network failure
 */
async function exchangeCodeForTokens({
  tokenUrl,
  clientId,
  clientSecret,
  code,
  redirectUri,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!tokenUrl) throw new Error('exchangeCodeForTokens: tokenUrl required');
  if (!clientId) throw new Error('exchangeCodeForTokens: clientId required');
  if (!clientSecret) throw new Error('exchangeCodeForTokens: clientSecret required');
  if (!code) throw new Error('exchangeCodeForTokens: code required');
  if (!redirectUri) throw new Error('exchangeCodeForTokens: redirectUri required');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  return _postForm(tokenUrl, body, timeoutMs, 'exchangeCodeForTokens');
}

/**
 * Exchange a refresh token for a fresh access + refresh token pair.
 *
 * RFC 6749 §6. Mirrors exchangeCodeForTokens but with grant_type=refresh_token
 * and no redirect_uri. LabCorp typically returns a new refresh_token as well
 * (refresh-rotation) — callers should always persist the new refresh_token
 * via storeTokens(), not just the access_token.
 *
 * @param {Object} opts
 * @param {string} opts.tokenUrl
 * @param {string} opts.clientId
 * @param {string} opts.clientSecret
 * @param {string} opts.refreshToken
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<Object>}
 * @throws {Error}
 */
async function refreshAccessToken({
  tokenUrl,
  clientId,
  clientSecret,
  refreshToken,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!tokenUrl) throw new Error('refreshAccessToken: tokenUrl required');
  if (!clientId) throw new Error('refreshAccessToken: clientId required');
  if (!clientSecret) throw new Error('refreshAccessToken: clientSecret required');
  if (!refreshToken) throw new Error('refreshAccessToken: refreshToken required');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  return _postForm(tokenUrl, body, timeoutMs, 'refreshAccessToken');
}

/**
 * Thin HTTP POST wrapper for token endpoint calls.
 *
 * Abstracted into its own helper (vs duplicating request code) because the
 * two flows differ only in body params — Content-Type, timeout handling,
 * error surfacing, and response parsing are identical.
 *
 * Design notes:
 *   - `req.setTimeout(ms, cb)` aborts the socket on inactivity; we destroy
 *     the request explicitly so the socket is freed and the Promise rejects.
 *   - Error messages carry the label ('exchangeCodeForTokens' / 'refreshAccessToken')
 *     so callers can distinguish flows in logs without string-matching bodies.
 *   - Non-2xx responses parse the JSON error shape per RFC 6749 §5.2 and
 *     surface `error` + `error_description` in the thrown message.
 */
function _postForm(tokenUrl, body, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(tokenUrl);
    } catch (err) {
      reject(new Error(`${label}: invalid tokenUrl: ${err.message}`));
      return;
    }

    const lib = url.protocol === 'https:' ? https : http;
    const options = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + (url.search || ''),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'application/json',
      },
      timeout: timeoutMs,
    };

    const req = lib.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        // Non-2xx: try to parse the OAuth2 error shape, fall back to raw
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let detail = raw;
          try {
            const parsed = JSON.parse(raw);
            if (parsed.error) {
              detail = `${parsed.error}${parsed.error_description ? ': ' + parsed.error_description : ''}`;
            }
          } catch {
            // leave detail as raw body
          }
          reject(new Error(`${label}: HTTP ${res.statusCode} — ${detail}`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(new Error(`${label}: failed to parse token response JSON: ${err.message}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`${label}: token request timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      reject(new Error(`${label}: ${err.message}`));
    });

    req.write(body);
    req.end();
  });
}

// ==========================================
// INTERNAL HELPERS
// ==========================================

/**
 * Constant-time string equality. `crypto.timingSafeEqual` requires equal-length
 * buffers; we short-circuit on length mismatch (which itself leaks length, but
 * state is fixed-length 64 hex so this isn't exploitable in practice).
 */
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return crypto.timingSafeEqual(ab, bb);
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  generateState,
  buildAuthorizeUrl,
  parseCallback,
  storeTokens,
  getTokens,
  deleteTokens,
  exchangeCodeForTokens,
  refreshAccessToken,
  // exported only for unit tests that want to exercise the helper directly
  _internal: { timingSafeEqualStr, _postForm },
};
