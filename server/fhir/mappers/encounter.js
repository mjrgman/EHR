'use strict';

/**
 * FHIR R4 Encounter Mapper
 * Translates internal encounters table → FHIR Encounter resource
 * Spec: https://hl7.org/fhir/R4/encounter.html
 */

const { codeableConcept, reference, period } = require('../utils/fhir-response');

// Internal status → FHIR EncounterStatus
const STATUS_MAP = {
  'in-progress': 'in-progress',
  'completed': 'finished',
  'signed': 'finished'
};

// Internal encounter_type → FHIR Encounter class
const CLASS_MAP = {
  'office_visit': { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
  'telehealth': { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'VR', display: 'virtual' },
  'follow_up': { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
  'new_patient': { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
  'sick_visit': { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' }
};

const DEFAULT_CLASS = { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' };

/**
 * Map internal encounter record to FHIR R4 Encounter resource
 * @param {Object} enc - Internal encounter row from database
 * @returns {Object} FHIR Encounter resource
 */
function toFhirEncounter(enc) {
  const resource = {
    resourceType: 'Encounter',
    id: String(enc.id),
    meta: {
      lastUpdated: enc.created_at
    },
    status: STATUS_MAP[enc.status] || 'unknown',
    class: CLASS_MAP[enc.encounter_type] || DEFAULT_CLASS,
    subject: reference('Patient', enc.patient_id),
    period: period(enc.encounter_date, enc.completed_at || null)
  };

  // Encounter type
  if (enc.encounter_type) {
    resource.type = [codeableConcept(
      'http://terminology.hl7.org/CodeSystem/encounter-type',
      enc.encounter_type,
      enc.encounter_type.replace(/_/g, ' ')
    )];
  }

  // Chief complaint as reason
  if (enc.chief_complaint) {
    resource.reasonCode = [{ text: enc.chief_complaint }];
  }

  // Provider as participant
  if (enc.provider) {
    resource.participant = [{
      type: [codeableConcept(
        'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
        'ATND',
        'attender'
      )],
      individual: { display: enc.provider }
    }];
  }

  // Duration
  if (enc.duration_minutes) {
    resource.length = {
      value: enc.duration_minutes,
      unit: 'minutes',
      system: 'http://unitsofmeasure.org',
      code: 'min'
    };
  }

  return resource;
}

module.exports = { toFhirEncounter };
