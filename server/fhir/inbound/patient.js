'use strict';

/**
 * FHIR R4 Inbound Patient Translator
 * Translates a FHIR Patient resource → internal patients table row.
 *
 * Returns { data, errors } where:
 *   data   — object ready for db.createPatient() if errors is empty
 *   errors — array of { field, message } describing validation failures
 */

/**
 * Parse a FHIR HumanName entry into { first_name, middle_name, last_name }.
 * Handles both given[] array and text fallback.
 */
function parseName(nameEntry) {
  if (!nameEntry) return {};
  const given = nameEntry.given || [];
  return {
    first_name: given[0] || null,
    middle_name: given.length > 1 ? given.slice(1).join(' ') : null,
    last_name: nameEntry.family || null,
  };
}

/**
 * Extract a telecom value by system (phone | email | fax).
 */
function pickTelecom(telecoms, system) {
  if (!Array.isArray(telecoms)) return null;
  const match = telecoms.find(t => t.system === system);
  return match ? match.value : null;
}

/**
 * Extract the first address entry.
 */
function parseAddress(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) return {};
  const addr = addresses[0];
  const lines = addr.line || [];
  return {
    address_line1: lines[0] || null,
    address_line2: lines.length > 1 ? lines.slice(1).join(', ') : null,
    city: addr.city || null,
    state: addr.state || null,
    zip: addr.postalCode || null,
  };
}

/**
 * Translate FHIR gender → internal sex value.
 * Internal: 'M' | 'F' | 'O' | 'U'
 */
const GENDER_MAP = {
  male: 'M',
  female: 'F',
  other: 'O',
  unknown: 'U',
};

/**
 * Main translator.
 * @param {Object} resource - FHIR Patient resource
 * @returns {{ data: Object|null, errors: Array }}
 */
function fromFhirPatient(resource) {
  const errors = [];

  if (!resource || resource.resourceType !== 'Patient') {
    errors.push({ field: 'resourceType', message: 'Expected resourceType Patient' });
    return { data: null, errors };
  }

  // Name — required
  const nameEntry = Array.isArray(resource.name) ? resource.name[0] : null;
  const { first_name, middle_name, last_name } = parseName(nameEntry);

  if (!first_name) errors.push({ field: 'name.given', message: 'Patient must have a given (first) name' });
  if (!last_name) errors.push({ field: 'name.family', message: 'Patient must have a family (last) name' });

  // Birth date — required
  if (!resource.birthDate) {
    errors.push({ field: 'birthDate', message: 'Patient birthDate is required' });
  }

  if (errors.length > 0) return { data: null, errors };

  const telecom = resource.telecom || [];
  const address = parseAddress(resource.address);

  // MRN from identifier (if present — internal system may generate one)
  let externalMrn = null;
  if (Array.isArray(resource.identifier)) {
    const mrnId = resource.identifier.find(i =>
      i.type?.coding?.some(c => c.code === 'MR') ||
      i.system?.includes('mrn') ||
      i.use === 'usual'
    );
    if (mrnId) externalMrn = mrnId.value;
  }

  const data = {
    first_name,
    middle_name: middle_name || null,
    last_name,
    dob: resource.birthDate,
    sex: GENDER_MAP[resource.gender] || 'U',
    phone: pickTelecom(telecom, 'phone'),
    email: pickTelecom(telecom, 'email'),
    ...address,
    // Insurance identifiers not in base FHIR Patient — leave null
    insurance_carrier: null,
    insurance_id: null,
    // Preserve external MRN as a note if provided
    _externalMrn: externalMrn,
  };

  return { data, errors: [] };
}

module.exports = { fromFhirPatient };
