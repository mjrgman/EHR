'use strict';

/**
 * FHIR R4 MedicationRequest Mapper
 * Translates internal prescriptions table → FHIR MedicationRequest resource
 * Spec: https://hl7.org/fhir/R4/medicationrequest.html
 */

const { codeableConcept, reference } = require('../utils/fhir-response');

// Internal status → FHIR MedicationRequestStatus
const STATUS_MAP = {
  'draft': 'draft',
  'signed': 'active',
  'transmitted': 'active',
  'dispensed': 'completed'
};

/**
 * Map internal prescription record to FHIR R4 MedicationRequest resource
 * @param {Object} rx - Internal prescription row from database
 * @returns {Object} FHIR MedicationRequest resource
 */
function toFhirMedicationRequest(rx) {
  const resource = {
    resourceType: 'MedicationRequest',
    id: String(rx.id),
    meta: {
      lastUpdated: rx.created_at
    },
    status: STATUS_MAP[rx.status] || 'unknown',
    intent: 'order',
    medicationCodeableConcept: { text: rx.medication_name },
    subject: reference('Patient', rx.patient_id),
    authoredOn: rx.prescribed_date
  };

  // Generic name as additional coding
  if (rx.generic_name) {
    resource.medicationCodeableConcept.coding = [{
      system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
      display: rx.generic_name
    }];
  }

  // Encounter
  if (rx.encounter_id) {
    resource.encounter = reference('Encounter', rx.encounter_id);
  }

  // Prescriber
  if (rx.prescriber) {
    resource.requester = { display: rx.prescriber };
  }

  // Dosage instruction
  const dosage = {};
  const parts = [];
  if (rx.dose) parts.push(rx.dose);
  if (rx.route) parts.push(rx.route);
  if (rx.frequency) parts.push(rx.frequency);
  if (parts.length) dosage.text = parts.join(' ');
  if (rx.instructions) dosage.patientInstruction = rx.instructions;
  if (rx.route) {
    dosage.route = { text: rx.route };
  }
  if (Object.keys(dosage).length) {
    resource.dosageInstruction = [dosage];
  }

  // Dispense request (quantity + refills)
  if (rx.quantity || rx.refills != null) {
    resource.dispenseRequest = {};
    if (rx.quantity) {
      resource.dispenseRequest.quantity = { value: rx.quantity };
    }
    if (rx.refills != null) {
      resource.dispenseRequest.numberOfRepeatsAllowed = rx.refills;
    }
  }

  // Indication as reason code
  if (rx.indication) {
    resource.reasonCode = [{ text: rx.indication }];
  }

  // ICD-10 codes for reason
  if (rx.icd10_codes) {
    try {
      const codes = typeof rx.icd10_codes === 'string' ? JSON.parse(rx.icd10_codes) : rx.icd10_codes;
      if (Array.isArray(codes) && codes.length) {
        resource.reasonCode = codes.map(code =>
          codeableConcept('http://hl7.org/fhir/sid/icd-10-cm', code, code)
        );
      }
    } catch (e) {
      // Non-JSON icd10_codes, keep as-is from indication
    }
  }

  return resource;
}

module.exports = { toFhirMedicationRequest };
