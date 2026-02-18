import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function AppShell({ children }) {
  const { currentRole, roleConfig, switchRole, roles, providerName } = useAuth();
  const [showRolePicker, setShowRolePicker] = useState(false);

  const roleColors = { blue: 'bg-blue-50 text-blue-700 border-blue-200', purple: 'bg-purple-50 text-purple-700 border-purple-200', green: 'bg-green-50 text-green-700 border-green-200' };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between z-50 sticky top-0">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-2xl">&#x1F3E5;</span>
          <div>
            <h1 className="text-lg font-bold text-gray-900 leading-tight">MJR-EHR</h1>
            <p className="text-xs text-gray-500 leading-tight">Intelligent Clinical Agent</p>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setShowRolePicker(!showRolePicker)}
              className={`min-h-[36px] px-3 py-1.5 rounded-lg text-sm font-semibold border ${roleColors[roleConfig.color] || roleColors.blue}`}
            >
              {roleConfig.label} &#x25BE;
            </button>
            {showRolePicker && (
              <div className="absolute right-0 top-full mt-1 bg-white border rounded-xl shadow-lg py-1 min-w-[180px] z-50">
                {Object.entries(roles).map(([key, val]) => (
                  <button key={key} onClick={() => { switchRole(key); setShowRolePicker(false); }}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-50 ${currentRole === key ? 'font-bold bg-gray-50' : ''}`}>
                    {val.label}{currentRole === key ? ' \u2713' : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="text-sm text-gray-600 hidden sm:block">
            <span className="font-medium">{providerName}</span>
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
