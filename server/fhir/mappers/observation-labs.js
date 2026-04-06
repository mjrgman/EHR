'use strict';

/**
 * FHIR R4 Observation (Laboratory) Mapper
 * Translates internal labs table → FHIR Observation resources
 * Spec: https://hl7.org/fhir/R4/observation.html
 */

const { codeableConcept, reference } = require('../utils/fhir-response');

const LOINC_SYSTEM = 'http://loinc.org';
const UCUM_SYSTEM = 'http://unitsofmeasure.org';

// Common lab test name → LOINC mapping
// Extend as needed when new lab types are added
const LAB_LOINC_MAP = {
  'hba1c':             { code: '4548-4',  display: 'Hemoglobin A1c', unit: '%', ucum: '%' },
  'hemoglobin a1c':    { code: '4548-4',  display: 'Hemoglobin A1c', unit: '%', ucum: '%' },
  'creatinine':        { code: '2160-0',  display: 'Creatinine', unit: 'mg/dL', ucum: 'mg/dL' },
  'egfr':              { code: '33914-3', display: 'eGFR', unit: 'mL/min/1.73m2', ucum: 'mL/min/{1.73_m2}' },
  'urine microalbumin': { code: '14957-5', display: 'Microalbumin [Mass/volume] in Urine', unit: 'mg/L', ucum: 'mg/L' },
  'bnp':               { code: '42637-9', display: 'BNP', unit: 'pg/mL', ucum: 'pg/mL' },
  'pt/inr':            { code: '6301-6',  display: 'INR', unit: 'INR', ucum: '{INR}' },
  'potassium':         { code: '2823-3',  display: 'Potassium', unit: 'mEq/L', ucum: 'meq/L' },
  'sodium':            { code: '2951-2',  display: 'Sodium', unit: 'mEq/L', ucum: 'meq/L' },
  'glucose':           { code: '2345-7',  display: 'Glucose', unit: 'mg/dL', ucum: 'mg/dL' },
  'bmp':               { code: '51990-0', display: 'Basic Metabolic Panel', unit: null, ucum: null },
  'cbc':               { code: '57021-8', display: 'Complete Blood Count', unit: null, ucum: null }
};

// Internal status → FHIR ObservationStatus
const STATUS_MAP = {
  'pending': 'registered',
  'resulted': 'preliminary',
  'final': 'final'
};

// Internal abnormal_flag → FHIR interpretation
const INTERPRETATION_MAP = {
  'H':  { code: 'H',  display: 'High' },
  'L':  { code: 'L',  display: 'Low' },
  'HH': { code: 'HH', display: 'Critical high' },
  'LL': { code: 'LL', display: 'Critical low' },
  'N':  { code: 'N',  display: 'Normal' },
  'A':  { code: 'A',  display: 'Abnormal' }
};

/**
 * Lookup LOINC info for a lab test name (case-insensitive)
 */
function lookupLoinc(testName) {
  if (!testName) return null;
  return LAB_LOINC_MAP[testName.toLowerCase()] || null;
}

/**
 * Map internal lab record to FHIR R4 Observation resource
 * @param {Object} lab - Internal lab row from database
 * @returns {Object} FHIR Observation resource
 */
function toFhirLabObservation(lab) {
  const loinc = lookupLoinc(lab.test_name);

  const resource = {
    resourceType: 'Observation',
    id: String(lab.id),
    status: STATUS_MAP[lab.status] || 'unknown',
    category: [codeableConcept(
      'http://terminology.hl7.org/CodeSystem/observation-category',
      'laboratory',
      'Laboratory'
    )],
    subject: reference('Patient', lab.patient_id)
  };

  // Code (LOINC if available, otherwise text only)
  if (loinc) {
    resource.code = codeableConcept(LOINC_SYSTEM, loinc.code, loinc.display);
  } else {
    resource.code = { text: lab.test_name };
  }

  // Effective date
  if (lab.result_date) {
    resource.effectiveDateTime = lab.result_date;
  }

  // Value
  if (lab.result_value != null) {
    const numericValue = parseFloat(lab.result_value);
    if (!isNaN(numericValue) && loinc && loinc.unit) {
      resource.valueQuantity = {
        value: numericValue,
        unit: loinc.unit,
        system: UCUM_SYSTEM,
        code: loinc.ucum
      };
    } else {
      resource.valueString = String(lab.result_value);
    }
  }

  // Reference range
  if (lab.reference_range) {
    resource.referenceRange = [{ text: lab.reference_range }];
  }

  // Interpretation (abnormal flag)
  if (lab.abnormal_flag) {
    const interp = INTERPRETATION_MAP[lab.abnormal_flag.toUpperCase()];
    if (interp) {
      resource.interpretation = [codeableConcept(
        'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
        interp.code,
        interp.display
      )];
    }
  }

  // Notes
  if (lab.notes) {
    resource.note = [{ text: lab.notes }];
  }

  return resource;
}

module.exports = { toFhirLabObservation, LAB_LOINC_MAP };
