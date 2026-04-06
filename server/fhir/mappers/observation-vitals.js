'use strict';

/**
 * FHIR R4 Observation (Vital Signs) Mapper
 * Translates internal vitals table → FHIR Observation resources
 * Spec: https://hl7.org/fhir/R4/observation-vitals.html
 * US Core: http://hl7.org/fhir/us/core/StructureDefinition/us-core-vital-signs
 */

const { codeableConcept, reference } = require('../utils/fhir-response');

// LOINC codes for vital signs (US Core required)
const VITAL_LOINC = {
  blood_pressure: { code: '85354-9', display: 'Blood pressure panel' },
  systolic_bp:    { code: '8480-6',  display: 'Systolic blood pressure' },
  diastolic_bp:   { code: '8462-4',  display: 'Diastolic blood pressure' },
  heart_rate:     { code: '8867-4',  display: 'Heart rate' },
  respiratory_rate: { code: '9279-1', display: 'Respiratory rate' },
  temperature:    { code: '8310-5',  display: 'Body temperature' },
  weight:         { code: '29463-7', display: 'Body weight' },
  height:         { code: '8302-2',  display: 'Body height' },
  bmi:            { code: '39156-5', display: 'Body mass index' },
  spo2:           { code: '2708-6',  display: 'Oxygen saturation' }
};

const LOINC_SYSTEM = 'http://loinc.org';
const UCUM_SYSTEM = 'http://unitsofmeasure.org';

/**
 * Build a single FHIR Observation for one vital sign
 */
function buildVitalObservation(id, patientId, encounterId, date, loincEntry, value, unit, ucumCode) {
  if (value == null) return null;

  const obs = {
    resourceType: 'Observation',
    id,
    meta: { profile: ['http://hl7.org/fhir/StructureDefinition/vitalsigns'] },
    status: 'final',
    category: [codeableConcept(
      'http://terminology.hl7.org/CodeSystem/observation-category',
      'vital-signs',
      'Vital Signs'
    )],
    code: codeableConcept(LOINC_SYSTEM, loincEntry.code, loincEntry.display),
    subject: reference('Patient', patientId),
    effectiveDateTime: date,
    valueQuantity: {
      value: Number(value),
      unit,
      system: UCUM_SYSTEM,
      code: ucumCode
    }
  };

  if (encounterId) {
    obs.encounter = reference('Encounter', encounterId);
  }

  return obs;
}

/**
 * Build a blood pressure panel Observation with systolic/diastolic components
 */
function buildBpObservation(id, patientId, encounterId, date, systolic, diastolic) {
  if (systolic == null && diastolic == null) return null;

  const obs = {
    resourceType: 'Observation',
    id,
    meta: { profile: ['http://hl7.org/fhir/StructureDefinition/vitalsigns'] },
    status: 'final',
    category: [codeableConcept(
      'http://terminology.hl7.org/CodeSystem/observation-category',
      'vital-signs',
      'Vital Signs'
    )],
    code: codeableConcept(LOINC_SYSTEM, VITAL_LOINC.blood_pressure.code, VITAL_LOINC.blood_pressure.display),
    subject: reference('Patient', patientId),
    effectiveDateTime: date,
    component: []
  };

  if (encounterId) {
    obs.encounter = reference('Encounter', encounterId);
  }

  if (systolic != null) {
    obs.component.push({
      code: codeableConcept(LOINC_SYSTEM, VITAL_LOINC.systolic_bp.code, VITAL_LOINC.systolic_bp.display),
      valueQuantity: { value: Number(systolic), unit: 'mmHg', system: UCUM_SYSTEM, code: 'mm[Hg]' }
    });
  }

  if (diastolic != null) {
    obs.component.push({
      code: codeableConcept(LOINC_SYSTEM, VITAL_LOINC.diastolic_bp.code, VITAL_LOINC.diastolic_bp.display),
      valueQuantity: { value: Number(diastolic), unit: 'mmHg', system: UCUM_SYSTEM, code: 'mm[Hg]' }
    });
  }

  return obs;
}

/**
 * Map a single vitals row into multiple FHIR Observation resources
 * @param {Object} v - Internal vitals row from database
 * @returns {Array<Object>} Array of FHIR Observation resources
 */
function toFhirVitalObservations(v) {
  const observations = [];
  const baseId = `vitals-${v.id}`;
  const date = v.recorded_date;
  const pid = v.patient_id;
  const eid = v.encounter_id;

  // Blood pressure as panel with components
  const bp = buildBpObservation(`${baseId}-bp`, pid, eid, date, v.systolic_bp, v.diastolic_bp);
  if (bp) observations.push(bp);

  // Individual vitals
  const singles = [
    { field: v.heart_rate,       loinc: VITAL_LOINC.heart_rate,      unit: 'beats/minute', ucum: '/min' },
    { field: v.respiratory_rate, loinc: VITAL_LOINC.respiratory_rate, unit: 'breaths/minute', ucum: '/min' },
    { field: v.temperature,      loinc: VITAL_LOINC.temperature,     unit: 'degF', ucum: '[degF]' },
    { field: v.weight,           loinc: VITAL_LOINC.weight,          unit: 'lbs', ucum: '[lb_av]' },
    { field: v.height,           loinc: VITAL_LOINC.height,          unit: 'in', ucum: '[in_i]' },
    { field: v.bmi,              loinc: VITAL_LOINC.bmi,             unit: 'kg/m2', ucum: 'kg/m2' },
    { field: v.spo2,             loinc: VITAL_LOINC.spo2,            unit: '%', ucum: '%' }
  ];

  for (const s of singles) {
    const suffix = s.loinc.code.replace(/-/g, '');
    const obs = buildVitalObservation(`${baseId}-${suffix}`, pid, eid, date, s.loinc, s.field, s.unit, s.ucum);
    if (obs) observations.push(obs);
  }

  return observations;
}

module.exports = { toFhirVitalObservations, VITAL_LOINC };
