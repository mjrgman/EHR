import React from 'react';

const STATE_CONFIG = {
  'scheduled': { label: 'Scheduled', icon: '\uD83D\uDCC5' },
  'checked-in': { label: 'Checked In', icon: '\u2705' },
  'roomed': { label: 'Roomed', icon: '\uD83D\uDEAA' },
  'vitals-recorded': { label: 'Vitals', icon: '\uD83D\uDC93' },
  'provider-examining': { label: 'Examining', icon: '\uD83E\uDE7A' },
  'orders-pending': { label: 'Orders', icon: '\uD83D\uDCCB' },
  'documentation': { label: 'Docs', icon: '\uD83D\uDCDD' },
  'signed': { label: 'Signed', icon: '\u270D\uFE0F' },
  'checked-out': { label: 'Done', icon: '\uD83C\uDFC1' },
};

const ALL_STATES = Object.keys(STATE_CONFIG);

export default function WorkflowTracker({ timeline, currentState, compact = false }) {
  if (!timeline && !currentState) return null;

  if (compact) {
    const cfg = STATE_CONFIG[currentState] || { label: currentState, icon: '?' };
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
        {cfg.icon} {cfg.label}
      </span>
    );
  }

  const states = timeline?.timeline || ALL_STATES.map(s => ({
    state: s, status: s === currentState ? 'current' : ALL_STATES.indexOf(s) < ALL_STATES.indexOf(currentState) ? 'completed' : 'pending'
  }));

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto py-2 px-1">
      {states.map((s, i) => {
        const cfg = STATE_CONFIG[s.state] || { label: s.state, icon: '?' };
        const done = s.status === 'completed';
        const cur = s.status === 'current';
        return (
          <React.Fragment key={s.state}>
            {i > 0 && <div className={`h-0.5 w-3 flex-shrink-0 ${done || cur ? 'bg-blue-400' : 'bg-gray-200'}`} />}
            <div className={`flex flex-col items-center flex-shrink-0 ${cur ? 'scale-110' : ''}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${
                done ? 'bg-blue-100 text-blue-600' : cur ? 'bg-blue-600 text-white ring-2 ring-blue-300' : 'bg-gray-100 text-gray-400'
              }`}>{done ? '\u2713' : cfg.icon}</div>
              <span className={`text-[9px] mt-0.5 whitespace-nowrap ${cur ? 'font-bold text-blue-700' : done ? 'text-blue-500' : 'text-gray-400'}`}>{cfg.label}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
