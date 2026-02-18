import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { usePatient } from '../hooks/usePatient';
import { useWorkflow } from '../hooks/useWorkflow';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import PatientBanner from '../components/patient/PatientBanner';
import WorkflowTracker from '../components/workflow/WorkflowTracker';
import LoadingSpinner from '../components/common/LoadingSpinner';

export default function MAPage() {
  const { encounterId } = useParams();
  const [encounter, setEncounter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const { workflow, timeline, transition } = useWorkflow(encounterId);
  const { patient, refresh: refreshPatient } = usePatient(encounter?.patient_id);
  const speech = useSpeechRecognition();
  const [vitals, setVitals] = useState({ systolic_bp: '', diastolic_bp: '', heart_rate: '', temperature: '', weight: '', height: '', respiratory_rate: '', spo2: '' });
  const [chiefComplaint, setChiefComplaint] = useState('');

  useEffect(() => {
    api.getEncounter(encounterId).then(enc => { setEncounter(enc); setChiefComplaint(enc.chief_complaint || ''); }).catch(console.error).finally(() => setLoading(false));
  }, [encounterId]);

  function updateVital(field, value) { setVitals(prev => ({ ...prev, [field]: value })); }

  async function extractVitalsFromSpeech() {
    if (!speech.transcript) return;
    try {
      const r = await api.addVitalsFromSpeech({ transcript: speech.transcript, patient_id: encounter.patient_id, encounter_id: parseInt(encounterId) });
      if (r.systolic_bp) setVitals(prev => ({ ...prev, systolic_bp: r.systolic_bp || prev.systolic_bp, diastolic_bp: r.diastolic_bp || prev.diastolic_bp, heart_rate: r.heart_rate || prev.heart_rate, temperature: r.temperature || prev.temperature, weight: r.weight || prev.weight, spo2: r.spo2 || prev.spo2 }));
    } catch (e) { console.error(e); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const data = { patient_id: encounter.patient_id, encounter_id: parseInt(encounterId), recorded_by: 'MA' };
      if (vitals.systolic_bp) data.systolic_bp = parseInt(vitals.systolic_bp);
      if (vitals.diastolic_bp) data.diastolic_bp = parseInt(vitals.diastolic_bp);
      if (vitals.heart_rate) data.heart_rate = parseInt(vitals.heart_rate);
      if (vitals.temperature) data.temperature = parseFloat(vitals.temperature);
      if (vitals.weight) data.weight = parseFloat(vitals.weight);
      if (vitals.height) data.height = parseFloat(vitals.height);
      if (vitals.respiratory_rate) data.respiratory_rate = parseInt(vitals.respiratory_rate);
      if (vitals.spo2) data.spo2 = parseInt(vitals.spo2);

      await api.addVitals(data);
      if (chiefComplaint) await api.updateEncounter(encounterId, { chief_complaint: chiefComplaint, patient_id: encounter.patient_id });

      try { await transition('roomed'); } catch(e) {}
      try { await transition('vitals-recorded'); } catch(e) {}

      await refreshPatient();
      navigate('/encounter/' + encounterId);
    } catch (e) { alert('Save failed: ' + e.message); } finally { setSaving(false); }
  }

  if (loading) return <LoadingSpinner message="Loading MA screen..." />;

  const fields = [
    { key: 'systolic_bp', label: 'Systolic BP', ph: '120', unit: 'mmHg' },
    { key: 'diastolic_bp', label: 'Diastolic BP', ph: '80', unit: 'mmHg' },
    { key: 'heart_rate', label: 'Heart Rate', ph: '72', unit: 'bpm' },
    { key: 'temperature', label: 'Temperature', ph: '98.6', unit: '\u00B0F' },
    { key: 'weight', label: 'Weight', ph: '170', unit: 'lbs' },
    { key: 'height', label: 'Height', ph: '68', unit: 'in' },
    { key: 'respiratory_rate', label: 'Resp Rate', ph: '16', unit: '/min' },
    { key: 'spo2', label: 'SpO2', ph: '98', unit: '%' },
  ];

  return (
    <div>
      {patient && <PatientBanner patient={patient} />}
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <TouchButton variant="secondary" size="sm" onClick={() => navigate('/')}>&#x2190; Dashboard</TouchButton>
          <WorkflowTracker timeline={timeline} currentState={workflow?.current_state} />
        </div>
        <Card><CardHeader>Chief Complaint</CardHeader><CardBody>
          <textarea value={chiefComplaint} onChange={e => setChiefComplaint(e.target.value)} placeholder="Reason for visit..."
            className="w-full border border-gray-300 rounded-xl p-3 text-base min-h-[60px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        </CardBody></Card>
        {speech.isSupported && (
          <Card><CardHeader>Voice Vitals Entry</CardHeader><CardBody className="space-y-3">
            <p className="text-sm text-gray-500">Say: "Blood pressure 142 over 88, heart rate 76, temperature 98.6, weight 187"</p>
            <div className="flex gap-2">
              <TouchButton variant={speech.isListening ? 'danger' : 'primary'} onClick={speech.isListening ? speech.stopListening : speech.startListening}>
                {speech.isListening ? 'Stop' : 'Listen'}
              </TouchButton>
              {speech.transcript && <TouchButton variant="success" size="sm" onClick={extractVitalsFromSpeech}>Extract Vitals</TouchButton>}
            </div>
            {(speech.transcript || speech.interimTranscript) && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm">{speech.transcript}<span className="text-gray-400 italic">{speech.interimTranscript}</span></div>
            )}
          </CardBody></Card>
        )}
        <Card><CardHeader>Vitals</CardHeader><CardBody>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {fields.map(f => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{f.label} ({f.unit})</label>
                <input type="number" value={vitals[f.key]} onChange={e => updateVital(f.key, e.target.value)} placeholder={f.ph}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-lg text-center focus:ring-2 focus:ring-blue-500" />
              </div>
            ))}
          </div>
        </CardBody></Card>
        <TouchButton variant="success" onClick={handleSave} loading={saving} className="w-full">Save Vitals and Send to Provider</TouchButton>
      </div>
    </div>
  );
}
