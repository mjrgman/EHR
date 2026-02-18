import React from 'react';
import Badge from '../common/Badge';

export default function AllergyBadges({ allergies = [] }) {
  if (allergies.length === 0) return <p className="text-sm text-gray-400 italic">No known allergies</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {allergies.map((a, i) => (
        <Badge key={i} variant="urgent">&#x26A0; {a.allergen}{a.reaction ? ` (${a.reaction})` : ''}</Badge>
      ))}
    </div>
  );
}
