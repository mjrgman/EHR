import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import Badge from '../components/common/Badge';
import LoadingSpinner from '../components/common/LoadingSpinner';
import QueueDashboard from '../components/workflow/QueueDashboard';

export default function DashboardPage() {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try { setPatients(await api.getPatients()); } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  async function startEncounter(pt) {
    setCreating(pt.id);
    try {
      const enc = await api.createEncounter({ patient_id: pt.id, encounter_type: 'Office Visit - Follow-up', chief_complaint: '', provider: 'Dr. MJR' });
      navigate('/checkin/' + enc.id);
    } catch (e) { alert('Failed: ' + e.message); } finally { setCreating(null); }
  }

  if (loading) return <LoadingSpinner message="Loading dashboard..." />;

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">MJR-EHR Intelligent Clinical Agent System</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>Active Encounters</CardHeader>
          <CardBody><QueueDashboard /></CardBody>
        </Card>

        <Card>
          <CardHeader>Patients</CardHeader>
          <CardBody className="p-0">
            <div className="divide-y divide-gray-50">
              {patients.map(pt => (
                <div key={pt.id} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => navigate('/patient/' + pt.id)}>
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm">
                      {pt.first_name?.[0]}{pt.last_name?.[0]}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{pt.last_name}, {pt.first_name}</p>
                      <p className="text-xs text-gray-500">MRN: {pt.mrn} | DOB: {pt.dob} | {pt.sex}</p>
                    </div>
                  </div>
                  <TouchButton size="sm" variant="primary" onClick={() => startEncounter(pt)} loading={creating === pt.id}>New Visit</TouchButton>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody className="py-3">
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <Badge variant="success" dot>System Online</Badge>
            <span>CDS Engine: 25 rules</span>
            <span>Provider Learning: Enabled</span>
            <span>Speech: Ready</span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
