'use strict';

/**
 * FHIR R4 Response Utilities
 * Content-Type handling, OperationOutcome factory, Bundle factory
 */

const FHIR_CONTENT_TYPE = 'application/fhir+json; charset=utf-8';

/**
 * Set FHIR-compliant response headers and send JSON
 */
function sendFhir(res, resource, statusCode = 200) {
  res.status(statusCode)
    .set('Content-Type', FHIR_CONTENT_TYPE)
    .json(resource);
}

/**
 * Build a FHIR OperationOutcome resource
 * @param {string} severity - fatal | error | warning | information
 * @param {string} code - IssueType code (not-found, invalid, etc.)
 * @param {string} diagnostics - Human-readable description
 */
function operationOutcome(severity, code, diagnostics) {
  return {
    resourceType: 'OperationOutcome',
    issue: [{
      severity,
      code,
      diagnostics
    }]
  };
}

/**
 * Send a FHIR error response
 */
function sendError(res, statusCode, code, diagnostics) {
  const severity = statusCode >= 500 ? 'fatal' : 'error';
  sendFhir(res, operationOutcome(severity, code, diagnostics), statusCode);
}

/**
 * Build a FHIR searchset Bundle
 * @param {string} resourceType - e.g. 'Patient', 'Condition'
 * @param {Array} resources - Array of FHIR resources for this page
 * @param {string} selfUrl - The request URL for the Bundle.link
 * @param {object} [options]
 * @param {number}  [options.total]            - Total matches before paging (defaults to resources.length)
 * @param {string}  [options.nextUrl]          - URL for next page (omitted if last page)
 * @param {string}  [options.prevUrl]          - URL for previous page (omitted if first page)
 * @param {Array}   [options.includeResources] - Resources added via _include (search.mode: 'include')
 */
function searchBundle(resourceType, resources, selfUrl, options = {}) {
  const {
    total = resources.length,
    nextUrl = null,
    prevUrl = null,
    includeResources = []
  } = options;

  const link = [{ relation: 'self', url: selfUrl }];
  if (prevUrl) link.push({ relation: 'previous', url: prevUrl });
  if (nextUrl) link.push({ relation: 'next',     url: nextUrl });

  const matchEntries = resources.map(resource => ({
    fullUrl: `${resourceType}/${resource.id}`,
    resource,
    search: { mode: 'match' }
  }));

  const includeEntries = includeResources.map(resource => ({
    fullUrl: `${resource.resourceType}/${resource.id}`,
    resource,
    search: { mode: 'include' }
  }));

  return {
    resourceType: 'Bundle',
    type: 'searchset',
    total,
    link,
    entry: [...matchEntries, ...includeEntries]
  };
}

/**
 * Build a FHIR CodeableConcept
 */
function codeableConcept(system, code, display) {
  const cc = { coding: [{ system, code }] };
  if (display) {
    cc.coding[0].display = display;
    cc.text = display;
  }
  return cc;
}

/**
 * Build a FHIR Identifier
 */
function identifier(system, value) {
  return { system, value };
}

/**
 * Build a FHIR Reference
 */
function reference(resourceType, id, display) {
  const ref = { reference: `${resourceType}/${id}` };
  if (display) ref.display = display;
  return ref;
}

/**
 * Build a FHIR Period
 */
function period(start, end) {
  const p = {};
  if (start) p.start = start;
  if (end) p.end = end;
  return p;
}

module.exports = {
  FHIR_CONTENT_TYPE,
  sendFhir,
  sendError,
  operationOutcome,
  searchBundle,
  codeableConcept,
  identifier,
  reference,
  period
};
