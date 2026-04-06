'use strict';

/**
 * FHIR Search Parameter Parsing
 * Handles common FHIR query parameters: _id, patient, identifier, category, date, status
 */

/**
 * Parse the 'patient' search parameter.
 * Accepts: "1", "Patient/1"
 * Returns: integer patient ID or null
 */
function parsePatientParam(value) {
  if (!value) return null;
  const str = String(value);
  // Strip "Patient/" prefix if present
  const id = str.startsWith('Patient/') ? str.slice(8) : str;
  const parsed = parseInt(id, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Parse the 'identifier' search parameter.
 * Accepts: "2018-04792" or "http://system|2018-04792"
 * Returns: { system: string|null, value: string }
 */
function parseIdentifierParam(value) {
  if (!value) return null;
  const str = String(value);
  const pipeIndex = str.indexOf('|');
  if (pipeIndex >= 0) {
    return {
      system: str.slice(0, pipeIndex) || null,
      value: str.slice(pipeIndex + 1)
    };
  }
  return { system: null, value: str };
}

/**
 * Parse the 'date' search parameter.
 * Supports: "2024-01-15", "ge2024-01-01", "le2024-12-31"
 * Returns: { prefix: string, value: string } or null
 */
function parseDateParam(value) {
  if (!value) return null;
  const str = String(value);
  const prefixes = ['eq', 'ne', 'gt', 'lt', 'ge', 'le', 'sa', 'eb'];
  for (const prefix of prefixes) {
    if (str.startsWith(prefix)) {
      return { prefix, value: str.slice(2) };
    }
  }
  return { prefix: 'eq', value: str };
}

/**
 * Build the self URL for a search Bundle from the Express request
 */
function buildSelfUrl(req) {
  const protocol = req.protocol;
  const host = req.get('host');
  const path = req.originalUrl;
  return `${protocol}://${host}${path}`;
}

/**
 * Parse FHIR paging parameters.
 * _count: page size (1-100, default 20)
 * _offset: zero-based start index (default 0)
 */
function parsePagingParams(query) {
  const rawCount  = parseInt(query._count,  10);
  const rawOffset = parseInt(query._offset, 10);
  const count  = Number.isNaN(rawCount)  ? 20 : Math.min(Math.max(rawCount, 1), 100);
  const offset = Number.isNaN(rawOffset) ? 0  : Math.max(rawOffset, 0);
  return { count, offset };
}

/**
 * Build a URL for a specific page offset, preserving all other query params.
 */
function buildPageUrl(req, newOffset) {
  const protocol = req.protocol;
  const host = req.get('host');
  const params = new URLSearchParams(req.query);
  params.set('_offset', String(newOffset));
  return `${protocol}://${host}${req.path}?${params.toString()}`;
}

/**
 * Parse _include parameter.
 * Accepts: "Encounter:patient", "Observation:patient"
 * Returns: Set of "ResourceType:searchParam" strings, or empty Set.
 */
function parseIncludeParam(value) {
  if (!value) return new Set();
  const values = Array.isArray(value) ? value : [value];
  return new Set(values.map(v => String(v).trim()).filter(Boolean));
}

module.exports = {
  parsePatientParam,
  parseIdentifierParam,
  parseDateParam,
  buildSelfUrl,
  parsePagingParams,
  buildPageUrl,
  parseIncludeParam
};
