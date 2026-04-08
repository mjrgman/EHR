import React from 'react';

export default function LabResults({ labs = [], limit = 10 }) {
  if (labs.length === 0) return <p className="text-sm text-gray-400 italic">No lab results</p>;
  return (
    <div className="space-y-1">
      {labs.slice(0, limit).map((lab, i) => {
        const isAbnormal = lab.abnormal_flag && lab.abnormal_flag !== 'normal';
        return (
          <div key={lab.id || lab.test_name + '-' + i} className={`flex items-center justify-between text-sm px-2 py-1 rounded ${isAbnormal ? 'bg-red-50' : ''}`}>
            <span className="text-gray-700 font-medium truncate flex-1">{lab.test_name}</span>
            <span className={`font-bold ml-2 ${isAbnormal ? 'text-red-700' : 'text-gray-900'}`}>
              {lab.result_value}{isAbnormal && (lab.abnormal_flag === 'high' ? ' \u2191' : lab.abnormal_flag === 'low' ? ' \u2193' : ' !')}
            </span>
            <span className="text-gray-400 ml-1 text-xs">{lab.units}</span>
          </div>
        );
      })}
    </div>
  );
}
