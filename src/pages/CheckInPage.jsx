import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { usePatient } from '../hooks/usePatient';
import { useWorkflow } from '../hooks/useWorkflow';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import PatientBanner from '../components/patient/PatientBanner';
import WorkflowTracker from '../components/workflow/WorkflowTracker';
import LoadingSpinner from '../components/common/LoadingSpinner';

export default function CheckInPage() {
  const { encounterId } = useParams();
  const [encounter, setEncounter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chiefComplaint, setChiefComplaint] = useState('');
  const navigate = useNavigate();
  const { workflow, timeline, transition } = useWorkflow(encounterId);
  const { patient } = usePatient(encounter?.patient_id);

  useEffect(() => {
    api.getEncounter(encounterId).then(enc => { setEncounter(enc); setChiefComplaint(enc.chief_complaint || ''); }).catch(console.error).finally(() => setLoading(false));
  }, [encounterId]);

  async function handleCheckIn() {
    try {
      if (chiefComplaint) await api.updateEncounter(encounterId, { chief_complaint: chiefComplaint });
      if (workflow?.current_state === 'scheduled') await transition('checked-in');
      navigate('/ma/' + encounterId);
    } catch (e) { alert('Check-in failed: ' + e.message); }
  }

  if (loading) return <LoadingSpinner message="Loading encounter..." />;

  return (
    <div>
      {patient && <PatientBanner patient={patient} />}
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <TouchButton variant="secondary" size="sm" onClick={() => navigate('/')}>&#x2190; Dashboard</TouchButton>
          <WorkflowTracker timeline={timeline} currentState={workflow?.current_state} />
        </div>
        <Card>
          <CardHeader>Check-In</CardHeader>
          <CardBody className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Chief Complaint / Reason for Visit</label>
              <textarea value={chiefComplaint} onChange={e => setChiefComplaint(e.target.value)}
                placeholder="e.g., Diabetes and hypertension follow-up"
                className="w-full border border-gray-300 rounded-xl p-3 text-base min-h-[80px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <TouchButton variant="success" onClick={handleCheckIn} className="w-full">&#x2705; Check In &amp; Send to MA</TouchButton>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
