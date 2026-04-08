import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { safeLog } from '../../api/client';
import WorkflowTracker from './WorkflowTracker';

const ROUTES = { 'scheduled': '/checkin', 'checked-in': '/checkin', 'roomed': '/ma', 'vitals-recorded': '/ma', 'provider-examining': '/encounter', 'orders-pending': '/encounter', 'documentation': '/encounter', 'signed': '/review', 'checked-out': '/checkout' };

export default function QueueDashboard() {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, []);

  async function load() {
    try { setWorkflows(await api.getAllWorkflows()); } catch (e) { safeLog.error('Queue load failed:', e); } finally { setLoading(false); }
  }

  if (loading) return <div className="animate-pulse p-4 text-gray-400">Loading queue...</div>;
  const active = workflows.filter(wf => wf.current_state !== 'checked-out');
  if (active.length === 0) return <div className="text-center py-8 text-gray-400"><p className="text-3xl mb-2">&#x1F4CB;</p><p>No active encounters.</p></div>;

  return (
    <div className="space-y-2">
      {active.map(wf => (
        <div key={wf.encounter_id} onClick={() => navigate((ROUTES[wf.current_state] || '/encounter') + '/' + wf.encounter_id)}
          className="bg-white rounded-xl border border-gray-100 p-4 hover:border-blue-200 hover:shadow-sm cursor-pointer transition-all active:scale-[0.99]">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="font-semibold text-gray-900">{wf.patient_first_name || 'Patient'} {wf.patient_last_name || ''}</span>
              <span className="text-gray-400 text-sm ml-2">Enc #{wf.encounter_id}</span>
            </div>
            <WorkflowTracker currentState={wf.current_state} compact />
          </div>
          {wf.assigned_provider && <p className="text-xs text-gray-500">Provider: {wf.assigned_provider}</p>}
        </div>
      ))}
    </div>
  );
}
