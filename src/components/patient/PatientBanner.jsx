import React from 'react';
import Badge from '../common/Badge';

function calcAge(dob) {
  if (!dob) return '?';
  const b = new Date(dob), n = new Date();
  let age = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) age--;
  return age;
}

export default function PatientBanner({ patient, compact = false }) {
  if (!patient) return null;
  const age = patient.age || calcAge(patient.dob);
  const allergies = patient.allergies || [];

  return (
    <div className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm">
            {patient.first_name?.[0]}{patient.last_name?.[0]}
          </div>
          <div>
            <h2 className="font-bold text-gray-900">
              {patient.first_name} {patient.last_name}
              <span className="text-gray-400 font-normal ml-2 text-sm">{age}{patient.sex || ''} | MRN: {patient.mrn}</span>
            </h2>
            {!compact && <p className="text-xs text-gray-500">DOB: {patient.dob} | {patient.insurance_carrier || 'No insurance'}</p>}
          </div>
        </div>
        {allergies.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-red-600 text-sm font-medium">&#x26A0; Allergies:</span>
            {allergies.map((a, i) => <Badge key={a.id || a.allergen || i} variant="urgent">{a.allergen}</Badge>)}
          </div>
        )}
      </div>
    </div>
  );
}
