'use strict';

/**
 * FHIR R4 Appointment Mapper
 * Translates internal appointments table → FHIR Appointment resource
 * Spec: https://hl7.org/fhir/R4/appointment.html
 */

const { codeableConcept, reference } = require('../utils/fhir-response');

// Internal status → FHIR AppointmentStatus
const STATUS_MAP = {
  'scheduled': 'booked',
  'confirmed': 'booked',
  'checked-in': 'arrived',
  'no-show': 'noshow',
  'cancelled': 'cancelled',
  'completed': 'fulfilled',
  'rescheduled': 'cancelled'   // FHIR has no 'rescheduled'; model as cancelled + new
};

/**
 * Map internal appointment record to FHIR R4 Appointment resource
 * @param {Object} appt - Internal appointment row from database
 * @returns {Object} FHIR Appointment resource
 */
function toFhirAppointment(appt) {
  // Build start/end DateTime from date + time + duration
  const startStr = `${appt.appointment_date}T${appt.appointment_time}`;
  const startDate = new Date(startStr);
  const endDate = new Date(startDate.getTime() + (appt.duration_minutes || 20) * 60000);

  const resource = {
    resourceType: 'Appointment',
    id: String(appt.id),
    meta: {
      lastUpdated: appt.updated_at || appt.created_at
    },
    status: STATUS_MAP[appt.status] || 'proposed',
    appointmentType: codeableConcept(
      'http://terminology.hl7.org/CodeSystem/v2-0276',
      appt.appointment_type,
      appt.appointment_type.replace(/_/g, ' ')
    ),
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    minutesDuration: appt.duration_minutes || 20,
    participant: [
      {
        actor: reference('Patient', appt.patient_id),
        status: 'accepted'
      }
    ]
  };

  // Provider participant
  if (appt.provider_name) {
    resource.participant.push({
      actor: { display: appt.provider_name },
      type: [codeableConcept(
        'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
        'ATND',
        'attender'
      )],
      status: 'accepted'
    });
  }

  // Chief complaint as reason
  if (appt.chief_complaint) {
    resource.reasonCode = [{ text: appt.chief_complaint }];
  }

  // Notes
  if (appt.notes) {
    resource.comment = appt.notes;
  }

  return resource;
}

module.exports = { toFhirAppointment };
