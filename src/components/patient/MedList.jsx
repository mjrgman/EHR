import React from 'react';

export default function MedList({ medications = [], compact = false }) {
  const active = medications.filter(m => m.status === 'active');
  if (active.length === 0) return <p className="text-sm text-gray-400 italic">No active medications</p>;

  return (
    <ul className="space-y-1.5">
      {active.map((m, i) => (
        <li key={i} className="text-sm">
          <span className="font-medium text-gray-800">{m.medication_name}</span>
          {!compact && <span className="text-gray-500 ml-1">{m.dose} {m.route} {m.frequency}</span>}
        </li>
      ))}
    </ul>
  );
}
