'use strict';

/**
 * MediVault — Patient-Directed Data Governance Module
 *
 * Six-agent system for clinical document management, reconciliation,
 * and patient-facing communication within the Agentic EHR.
 *
 * Agents:
 *   1. Ingestion Agent     — document intake, classification, date extraction
 *   2. Dedup Agent         — timeline deduplication with provenance preservation
 *   3. Reconciliation Agent — cross-source medication, allergy, and problem reconciliation
 *   4. Specialty Packaging — specialty-tailored clinical packet generation
 *   5. Translation Agent   — plain-language conversion at 6th-grade reading level
 *   6. Red Flag Agent      — critical lab values, medication interactions, care gaps
 *
 * All agents operate at CATC Tier 3 (Physician-in-the-Loop).
 * No MediVault output enters the patient record or reaches the patient
 * without explicit physician review.
 *
 * Usage:
 *   const medivault = require('./medivault');
 *
 *   // Access agents
 *   const ingestion = new medivault.IngestionAgent();
 *   const dedup = new medivault.DedupAgent();
 *
 *   // Tables are initialized on require()
 */

const db = require('../database');
const { dbRun } = db;

// ==========================================
// AGENT IMPORTS
// ==========================================

const { IngestionAgent } = require('./agents/ingestion-agent');
const { DedupAgent } = require('./agents/dedup-agent');
const { ReconciliationAgent } = require('./agents/reconciliation-agent');
const { SpecialtyPackagingAgent } = require('./agents/specialty-packaging-agent');
const { TranslationAgent } = require('./agents/translation-agent');
const { RedFlagAgent } = require('./agents/red-flag-agent');

// ==========================================
// FHIR MAPPER IMPORTS (used by buildPatientBundle below)
// ==========================================

const { toFhirPatient } = require('../fhir/mappers/patient');
const { toFhirCondition } = require('../fhir/mappers/condition');
const { toFhirAllergyIntolerance } = require('../fhir/mappers/allergy-intolerance');
const { toFhirMedicationRequest } = require('../fhir/mappers/medication-request');
const { toFhirLabObservation } = require('../fhir/mappers/observation-labs');
const { toFhirVitalObservations } = require('../fhir/mappers/observation-vitals');

// ==========================================
// DATABASE TABLE INITIALIZATION
// ==========================================

const INIT_TABLES = [
  `CREATE TABLE IF NOT EXISTS vault_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    document_type TEXT,
    source_system TEXT,
    original_filename TEXT,
    ocr_text TEXT,
    ocr_confidence REAL,
    classification TEXT,
    extracted_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS vault_timeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    event_type TEXT,
    event_date TEXT,
    description TEXT,
    source_document_id INTEGER,
    deduplicated BOOLEAN DEFAULT 0,
    canonical_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (source_document_id) REFERENCES vault_documents(id) ON DELETE SET NULL,
    FOREIGN KEY (canonical_id) REFERENCES vault_timeline(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS vault_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    conflict_type TEXT,
    item_name TEXT,
    source1_value TEXT,
    source1_document_id INTEGER,
    source2_value TEXT,
    source2_document_id INTEGER,
    resolution_status TEXT DEFAULT 'pending',
    resolved_by TEXT,
    resolved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (source1_document_id) REFERENCES vault_documents(id) ON DELETE SET NULL,
    FOREIGN KEY (source2_document_id) REFERENCES vault_documents(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS vault_access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    accessed_by TEXT,
    access_type TEXT,
    resource_accessed TEXT,
    authorized BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS specialty_packets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    specialty TEXT,
    content TEXT,
    generated_by TEXT,
    reviewed_by TEXT,
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS patient_translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    source_packet_id INTEGER,
    plain_language_text TEXT,
    reading_level TEXT DEFAULT '6th-grade',
    reviewed_by TEXT,
    reviewed_at DATETIME,
    status TEXT CHECK(status IN ('draft','physician_review','approved','delivered')) DEFAULT 'draft',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (source_packet_id) REFERENCES specialty_packets(id) ON DELETE SET NULL
  )`
];

// Initialize all tables on module load
(async function initMediVaultTables() {
  for (const sql of INIT_TABLES) {
    try {
      await dbRun(sql);
    } catch (err) {
      console.error('[MediVault] Table initialization error:', err.message);
    }
  }
  console.log('[MediVault] Database tables initialized');
})();

// ==========================================
// PATIENT EXPORT — FHIR R4 Bundle assembly
//
// Phase 3c of the glistening-forging-frog plan. Builds a patient-owned
// export: a FHIR R4 Bundle of type 'collection' containing the patient's
// core clinical record. Used by the MediVault export endpoint
// (GET /api/medivault/export/:patientId) and by any downstream consumer
// that wants a single-file snapshot of a patient record.
//
// 'collection' (not 'searchset') is the right type here because the
// bundle is an offline export — it's not a response to a specific search
// and has no paging semantics. Per FHIR R4 Bundle.type definition,
// 'collection' is "a set of resources collected into a single logical
// package that has no particular use" — which is exactly right for a
// patient-owned data export.
//
// The Bundle is assembled from authoritative clinical rows only. The
// caller is responsible for auditing the access — this function does
// NOT write to vault_access_log; that's the route handler's job so the
// access record names the authenticated caller, not "system".
// ==========================================

async function buildPatientBundle(patientId) {
  if (!patientId) {
    throw new Error('buildPatientBundle: patientId is required');
  }

  const patient = await db.getPatientById(patientId);
  if (!patient) {
    const err = new Error(`Patient not found: ${patientId}`);
    err.code = 'PATIENT_NOT_FOUND';
    throw err;
  }

  const entry = [];

  // Patient resource is always first — it's the subject of every other
  // resource in the bundle.
  entry.push({
    fullUrl: `urn:uuid:patient-${patient.id}`,
    resource: toFhirPatient(patient)
  });

  // Conditions (problem list). toFhirCondition populates subject.reference
  // as "Patient/<patient_id>", so downstream consumers can resolve the
  // subject by traversing the bundle.
  const problems = await db.getPatientProblems(patientId);
  for (const p of problems || []) {
    entry.push({
      fullUrl: `urn:uuid:condition-${p.id}`,
      resource: toFhirCondition(p)
    });
  }

  // Allergies. toFhirAllergyIntolerance populates patient.reference (note:
  // AllergyIntolerance uses `patient` rather than `subject`, per FHIR R4
  // Patient Compartment definition).
  const allergies = await db.getPatientAllergies(patientId);
  for (const a of allergies || []) {
    entry.push({
      fullUrl: `urn:uuid:allergy-${a.id}`,
      resource: toFhirAllergyIntolerance(a)
    });
  }

  // Medications. Active + historical — the FHIR MedicationRequest.status
  // field carries whether a given order is active, completed, stopped, etc.
  const medications = await db.getPatientMedications(patientId);
  for (const m of medications || []) {
    entry.push({
      fullUrl: `urn:uuid:medrequest-${m.id}`,
      resource: toFhirMedicationRequest(m)
    });
  }

  // Labs → Observation (category=laboratory). Each row maps to one Observation.
  const labs = await db.getPatientLabs(patientId);
  for (const l of labs || []) {
    entry.push({
      fullUrl: `urn:uuid:observation-lab-${l.id}`,
      resource: toFhirLabObservation(l)
    });
  }

  // Vitals → Observation (category=vital-signs). One vitals row fans out
  // to multiple Observation resources (one per measurement) — toFhirVitalObservations
  // returns an array.
  const vitalRows = await db.getPatientVitals(patientId);
  for (const v of vitalRows || []) {
    const vitalObs = toFhirVitalObservations(v) || [];
    for (const obs of vitalObs) {
      entry.push({
        fullUrl: `urn:uuid:observation-vital-${v.id}-${obs.code?.coding?.[0]?.code || 'unknown'}`,
        resource: obs
      });
    }
  }

  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: new Date().toISOString(),
    entry
  };
}

// ==========================================
// MODULE EXPORTS
// ==========================================

module.exports = {
  // Agent classes
  IngestionAgent,
  DedupAgent,
  ReconciliationAgent,
  SpecialtyPackagingAgent,
  TranslationAgent,
  RedFlagAgent,

  // Patient export
  buildPatientBundle,

  // Convenience: all agents as an array for bulk registration
  getAllAgents() {
    return [
      new IngestionAgent(),
      new DedupAgent(),
      new ReconciliationAgent(),
      new SpecialtyPackagingAgent(),
      new TranslationAgent(),
      new RedFlagAgent()
    ];
  }
};
