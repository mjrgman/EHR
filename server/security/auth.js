/**
 * Authentication Module for Agentic EHR
 *
 * JWT-based authentication with bcrypt password hashing.
 * Replaces the previous header-trust model (x-user-id / x-user-role).
 *
 * Usage:
 *   const auth = require('./security/auth');
 *   await auth.init(db);
 *   app.use(auth.requireAuth);                // protect all routes
 *   app.post('/api/auth/login', auth.login);  // login endpoint
 *   app.post('/api/auth/logout', auth.logout);
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createUsersTable } = require('../database-migrations');

// ==========================================
// CONFIGURATION
// ==========================================

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';
const BCRYPT_ROUNDS = 12;

// Warn if using a generated secret (won't survive restarts)
if (!process.env.JWT_SECRET) {
  console.warn('[AUTH] WARNING: JWT_SECRET not set — using ephemeral key. Sessions will not survive server restarts.');
  console.warn('[AUTH] Set JWT_SECRET in your environment for persistent authentication.');
}

let db = null;

// ==========================================
// INITIALIZATION
// ==========================================

async function init(dbInstance) {
  if (!dbInstance) throw new Error('Database instance required for auth module');
  db = dbInstance;

  // Create or upgrade users table — must match database-migrations.js schema exactly
  await createUsersTable(db);

  // Check if users table is empty and advise on user creation
  const count = await db.dbGet('SELECT COUNT(*) as c FROM users');
  if (count.c === 0) {
    console.log('[AUTH] No users found. Create users via auth.createUser() or a setup script.');
    console.log('[AUTH] Example: auth.createUser("dr.renner", "securePassword", "Dr. Michael Renner", "physician", "dr.renner@clinic.com")');
  }

  console.log('[AUTH] Authentication module initialized');
}

// ==========================================
// JWT HELPERS
// ==========================================

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// ==========================================
// ROUTE HANDLERS
// ==========================================

/**
 * POST /api/auth/login
 * Accepts: { username, password }
 * Returns: { token, user: { id, username, role, displayName } }
 */
async function login(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await db.dbGet(
      'SELECT * FROM users WHERE username = ? AND is_active = 1',
      [username]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await db.dbRun(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );

    const token = signToken(user);

    // Issue refresh token if the module is initialized
    let refreshToken = null;
    let refreshExpiresAt = null;
    try {
      const refreshMod = require('./refresh-tokens');
      const rt = await refreshMod.create(user.id);
      refreshToken = rt.refreshToken;
      refreshExpiresAt = rt.expiresAt;
    } catch {
      // Refresh tokens not initialized yet — skip
    }

    res.json({
      token,
      refreshToken,
      refreshExpiresAt,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        fullName: user.full_name,
      }
    });
  } catch (error) {
    console.error('[AUTH] Login error:', error.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * POST /api/auth/logout
 * Invalidates the session (client should discard the token)
 */
async function logout(req, res) {
  // With stateless JWT, logout is client-side (discard token).
  // We log the event for audit purposes.
  const userId = req.user?.username || 'unknown';
  console.log(`[AUTH] User ${userId} logged out`);
  res.json({ message: 'Logged out successfully' });
}

/**
 * GET /api/auth/me
 * Returns current authenticated user info
 */
async function me(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({
    id: req.user.sub,
    username: req.user.username,
    role: req.user.role,
    fullName: req.user.fullName,
  });
}

// ==========================================
// MIDDLEWARE
// ==========================================

/**
 * Authentication middleware — validates JWT from:
 *   1. Authorization: Bearer <token>
 *   2. x-auth-token header
 *
 * In development mode (NODE_ENV !== 'production'), falls back to
 * a default physician identity for convenience. In production,
 * unauthenticated requests are rejected with 401.
 */
function requireAuth(req, res, next) {
  // Public routes that skip auth
  const publicPaths = ['/api/auth/login', '/api/health'];
  if (publicPaths.some(p => req.path === p)) {
    return next();
  }

  // Extract token
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.headers['x-auth-token'];

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      // Attach user info to request (replaces the old x-user-id/x-user-role headers)
      req.user = decoded;
      req.session = req.session || {};
      req.session.userId = decoded.username;
      req.session.userRole = decoded.role;
      return next();
    }
    // Token present but invalid
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // No token — check dev mode
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    // In dev, allow header-based identity for backward compatibility with tests,
    // but default to physician if nothing is provided
    req.user = {
      sub: 0,
      username: req.headers['x-user-id'] || 'dev-physician',
      role: req.headers['x-user-role'] || 'physician',
      fullName: 'Dev Physician',
    };
    req.session = req.session || {};
    req.session.userId = req.user.username;
    req.session.userRole = req.user.role;
    return next();
  }

  // Production — reject
  return res.status(401).json({ error: 'Authentication required' });
}

// ==========================================
// USER MANAGEMENT
// ==========================================

/**
 * Create a new user (admin only)
 */
async function createUser(username, password, fullName, role, email, phone = null, npiNumber = null) {
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const result = await db.dbRun(
    `INSERT INTO users (username, password_hash, full_name, role, email, phone, npi_number) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [username, hash, fullName, role, email, phone, npiNumber]
  );
  return { id: result.lastID, username, fullName, role, email };
}

/**
 * Change password
 */
async function changePassword(userId, newPassword) {
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db.dbRun(
    'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [hash, userId]
  );
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  init,
  login,
  logout,
  me,
  requireAuth,
  createUser,
  changePassword,
  signToken,
  verifyToken,
  JWT_SECRET,
};
