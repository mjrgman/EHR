import React from 'react';

export default function ProblemList({ problems = [], compact = false }) {
  const all = problems.filter(p => p.status === 'active' || p.status === 'chronic');
  if (all.length === 0) return <p className="text-sm text-gray-400 italic">No active problems</p>;

  return (
    <ul className="space-y-1.5">
      {all.map((p, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.status === 'chronic' ? 'bg-amber-400' : 'bg-blue-500'}`} />
          <div className="flex-1 min-w-0">
            <span className="font-medium text-gray-800">{p.problem_name}</span>
            {!compact && p.icd10_code && <span className="text-gray-400 ml-1 text-xs">({p.icd10_code})</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
