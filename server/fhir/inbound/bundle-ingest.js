'use strict';

/**
 * FHIR Bundle Ingestion Service
 *
 * Processes a FHIR transaction/batch Bundle and persists supported resource
 * types (Patient, Encounter) to the internal database.
 *
 * Idempotency: fhir_id_map provides a durable external-ID → internal-ID
 * mapping. Replaying the same bundle returns the existing mappings without
 * re-inserting records.
 *
 * Supported resource types: Patient, Encounter
 * Unsupported types: logged as 'skipped' in fhir_ingest_items, no error.
 */

const crypto = require('crypto');
const db = require('../../database');
const { fromFhirPatient } = require('./patient');
const { fromFhirEncounter } = require('./encounter');

const SUPPORTED_TYPES = new Set(['Patient', 'Encounter']);

// ──────────────────────────────────────────
// ID MAP HELPERS
// ──────────────────────────────────────────

async function lookupIdMap(resourceType, externalId) {
  return db.dbGet(
    'SELECT * FROM fhir_id_map WHERE resource_type = ? AND external_id = ?',
    [resourceType, externalId]
  );
}

async function insertIdMap(resourceType, externalId, internalId, internalTable, jobId) {
  await db.dbRun(
    `INSERT INTO fhir_id_map
       (resource_type, external_id, internal_id, internal_table, first_seen_job, last_updated_job)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [resourceType, externalId, internalId, internalTable, jobId, jobId]
  );
}

async function updateIdMapJob(resourceType, externalId, jobId) {
  await db.dbRun(
    `UPDATE fhir_id_map SET last_updated_job = ?, updated_at = CURRENT_TIMESTAMP
     WHERE resource_type = ? AND external_id = ?`,
    [jobId, resourceType, externalId]
  );
}

// ──────────────────────────────────────────
// JOB HELPERS
// ──────────────────────────────────────────

async function createJob(jobId, bundleType, resourceCount, submittedBy, source) {
  await db.dbRun(
    `INSERT INTO fhir_ingest_jobs
       (job_id, source, status, bundle_type, resource_count, submitted_by)
     VALUES (?, ?, 'processing', ?, ?, ?)`,
    [jobId, source || null, bundleType || 'batch', resourceCount, submittedBy || null]
  );
}

async function finalizeJob(jobId, successCount, failureCount) {
  const status = failureCount === 0 ? 'completed'
    : successCount === 0 ? 'failed'
    : 'partial';
  await db.dbRun(
    `UPDATE fhir_ingest_jobs
     SET status = ?, success_count = ?, failure_count = ?, completed_at = CURRENT_TIMESTAMP
     WHERE job_id = ?`,
    [status, successCount, failureCount, jobId]
  );
}

async function recordItem(jobId, index, resourceType, externalId, status, internalId, errorCode, errorMessage) {
  await db.dbRun(
    `INSERT INTO fhir_ingest_items
       (job_id, entry_index, resource_type, external_id, status, internal_id, error_code, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [jobId, index, resourceType, externalId || null, status, internalId || null, errorCode || null, errorMessage || null]
  );
}

// ──────────────────────────────────────────
// RESOURCE PROCESSORS
// ──────────────────────────────────────────

async function processPatient(resource, jobId) {
  const externalId = resource.id || null;

  // Idempotency check
  if (externalId) {
    const existing = await lookupIdMap('Patient', externalId);
    if (existing) {
      await updateIdMapJob('Patient', externalId, jobId);
      return { status: 'skipped', internalId: existing.internal_id, note: 'idempotent-replay' };
    }
  }

  const { data, errors } = fromFhirPatient(resource);
  if (errors.length > 0) {
    return { status: 'failed', errorCode: 'validation-error', errorMessage: errors.map(e => e.message).join('; ') };
  }

  const result = await db.createPatient(data);
  if (externalId) {
    await insertIdMap('Patient', externalId, result.id, 'patients', jobId);
  }
  return { status: 'success', internalId: result.id };
}

async function processEncounter(resource, jobId, localIdMap) {
  const externalId = resource.id || null;

  // Idempotency check
  if (externalId) {
    const existing = await lookupIdMap('Encounter', externalId);
    if (existing) {
      await updateIdMapJob('Encounter', externalId, jobId);
      return { status: 'skipped', internalId: existing.internal_id, note: 'idempotent-replay' };
    }
  }

  // Resolve patient reference
  let resolvedPatientId = null;
  const subjectRef = resource.subject?.reference;
  if (subjectRef) {
    // Try local in-bundle map first (Patient processed earlier in this job)
    if (localIdMap.has(subjectRef)) {
      resolvedPatientId = localIdMap.get(subjectRef);
    } else {
      // Fall back to fhir_id_map for cross-bundle references
      const refId = subjectRef.replace(/^Patient\//, '');
      const mapped = await lookupIdMap('Patient', refId);
      if (mapped) resolvedPatientId = mapped.internal_id;
    }
  }

  const { data, errors } = fromFhirEncounter(resource, resolvedPatientId);
  if (errors.length > 0) {
    return { status: 'failed', errorCode: 'validation-error', errorMessage: errors.map(e => e.message).join('; ') };
  }

  const result = await db.createEncounter(data);
  if (externalId) {
    await insertIdMap('Encounter', externalId, result.id, 'encounters', jobId);
  }
  return { status: 'success', internalId: result.id };
}

// ──────────────────────────────────────────
// MAIN ENTRY POINT
// ──────────────────────────────────────────

/**
 * Ingest a FHIR Bundle.
 *
 * @param {Object} bundle     - FHIR Bundle resource (type: transaction or batch)
 * @param {Object} opts
 * @param {string} opts.submittedBy - username from req.user
 * @param {string} [opts.source]    - source system identifier
 * @returns {Object} { jobId, results: Array, successCount, failureCount, skippedCount }
 */
async function ingestBundle(bundle, opts = {}) {
  if (!bundle || bundle.resourceType !== 'Bundle') {
    throw Object.assign(new Error('Expected resourceType Bundle'), { code: 'invalid-bundle' });
  }

  const entries = Array.isArray(bundle.entry) ? bundle.entry : [];
  const jobId = crypto.randomUUID();
  const bundleType = bundle.type || 'batch';

  await createJob(jobId, bundleType, entries.length, opts.submittedBy, opts.source);

  // localIdMap tracks Patient/id -> internal_id within this bundle for forward references
  // Key format: "Patient/<externalId>"
  const localIdMap = new Map();

  const results = [];
  let successCount = 0;
  let failureCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < entries.length; i++) {
    const resource = entries[i].resource;
    if (!resource || !resource.resourceType) {
      await recordItem(jobId, i, 'unknown', null, 'failed', null, 'missing-resource', 'Bundle entry has no resource');
      failureCount++;
      results.push({ index: i, resourceType: null, status: 'failed', error: 'missing-resource' });
      continue;
    }

    const { resourceType, id: externalId } = resource;

    if (!SUPPORTED_TYPES.has(resourceType)) {
      await recordItem(jobId, i, resourceType, externalId, 'skipped', null, null, `${resourceType} ingestion not yet supported`);
      skippedCount++;
      results.push({ index: i, resourceType, externalId, status: 'skipped' });
      continue;
    }

    let outcome;
    try {
      if (resourceType === 'Patient') {
        outcome = await processPatient(resource, jobId);
        // Register in local map for within-bundle references
        if (externalId && outcome.internalId) {
          localIdMap.set(`Patient/${externalId}`, outcome.internalId);
        }
      } else if (resourceType === 'Encounter') {
        outcome = await processEncounter(resource, jobId, localIdMap);
      }
    } catch (err) {
      outcome = { status: 'failed', errorCode: 'exception', errorMessage: err.message };
    }

    const itemStatus = outcome.note === 'idempotent-replay' ? 'skipped' : outcome.status;
    await recordItem(jobId, i, resourceType, externalId, itemStatus, outcome.internalId, outcome.errorCode, outcome.errorMessage);

    if (outcome.status === 'success') {
      successCount++;
      results.push({ index: i, resourceType, externalId, status: 'success', internalId: outcome.internalId });
    } else if (outcome.note === 'idempotent-replay') {
      skippedCount++;
      results.push({ index: i, resourceType, externalId, status: 'skipped', note: 'idempotent-replay', internalId: outcome.internalId });
    } else {
      failureCount++;
      results.push({ index: i, resourceType, externalId, status: 'failed', error: outcome.errorCode, message: outcome.errorMessage });
    }
  }

  await finalizeJob(jobId, successCount, failureCount);

  return { jobId, results, successCount, failureCount, skippedCount };
}

module.exports = { ingestBundle, lookupIdMap };
