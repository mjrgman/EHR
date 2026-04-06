'use strict';

/**
 * FHIR R4 AllergyIntolerance Mapper
 * Translates internal allergies table → FHIR AllergyIntolerance resource
 * Spec: https://hl7.org/fhir/R4/allergyintolerance.html
 */

const { codeableConcept, reference } = require('../utils/fhir-response');

// Internal severity → FHIR AllergyIntolerance reaction severity
const SEVERITY_MAP = {
  'mild': 'mild',
  'moderate': 'moderate',
  'severe': 'severe'
};

/**
 * Map internal allergy record to FHIR R4 AllergyIntolerance resource
 * @param {Object} allergy - Internal allergy row from database
 * @returns {Object} FHIR AllergyIntolerance resource
 */
function toFhirAllergyIntolerance(allergy) {
  const resource = {
    resourceType: 'AllergyIntolerance',
    id: String(allergy.id),
    meta: {
      lastUpdated: allergy.created_at
    },
    clinicalStatus: codeableConcept(
      'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
      'active',
      'Active'
    ),
    verificationStatus: codeableConcept(
      'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
      allergy.verified ? 'confirmed' : 'unconfirmed',
      allergy.verified ? 'Confirmed' : 'Unconfirmed'
    ),
    type: 'allergy',
    patient: reference('Patient', allergy.patient_id),
    code: { text: allergy.allergen }
  };

  // Onset
  if (allergy.onset_date) {
    resource.onsetDateTime = allergy.onset_date;
  }

  // Reaction
  if (allergy.reaction || allergy.severity) {
    const reaction = {};
    if (allergy.reaction) {
      reaction.manifestation = [{ text: allergy.reaction }];
    }
    if (allergy.severity && SEVERITY_MAP[allergy.severity]) {
      reaction.severity = SEVERITY_MAP[allergy.severity];
    }
    resource.reaction = [reaction];
  }

  // Notes
  if (allergy.notes) {
    resource.note = [{ text: allergy.notes }];
  }

  return resource;
}

module.exports = { toFhirAllergyIntolerance };
