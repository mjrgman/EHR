import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { usePatient } from '../hooks/usePatient';
import { useWorkflow } from '../hooks/useWorkflow';
import { useEncounter } from '../hooks/useEncounter';
import { useCDS } from '../hooks/useCDS';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import PatientBanner from '../components/patient/PatientBanner';
import ProblemList from '../components/patient/ProblemList';
import MedList from '../components/patient/MedList';
import VitalsDisplay from '../components/patient/VitalsDisplay';
import LabResults from '../components/patient/LabResults';
import WorkflowTracker from '../components/workflow/WorkflowTracker';
import CDSSuggestionList from '../components/encounter/CDSSuggestionList';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import Badge from '../components/common/Badge';
import LoadingSpinner from '../components/common/LoadingSpinner';

export default function EncounterPage() {
  const { encounterId } = useParams();
  const eid = parseInt(encounterId);
  const navigate = useNavigate();

  const { encounter, orders, update: updateEncounter, refresh: refreshEncounter } = useEncounter(eid);
  const { patient, refresh: refreshPatient } = usePatient(encounter?.patient_id);
  const { workflow, timeline, transition } = useWorkflow(eid);
  const { suggestions, pending, accepted, evaluate, accept, reject, refresh: refreshCDS } = useCDS(eid, encounter?.patient_id, { pollInterval: 5000, autoEvaluate: true });

  const speech = useSpeechRecognition();
  const [transcript, setTranscript] = useState('');
  const [soapNote, setSoapNote] = useState('');
  const [extractedData, setExtractedData] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (encounter) {
      setTranscript(encounter.transcript || '');
      setSoapNote(encounter.soap_note || '');
      setLoading(false);
    }
  }, [encounter]);

  // Append live speech to transcript
  useEffect(() => {
    if (speech.transcript && !speech.isListening) {
      setTranscript(prev => {
        const sep = prev ? '\n' : '';
        return prev + sep + speech.transcript;
      });
    }
  }, [speech.transcript, speech.isListening]);

  async function handleStartExam() {
    try {
      await transition('provider-examining');
    } catch (e) { /* may already be in this state */ }
  }

  async function handleExtract() {
    if (!transcript.trim()) return;
    setExtracting(true);
    try {
      const result = await api.extractData({
        transcript,
        patient_id: encounter.patient_id,
        encounter_id: eid
      });
      setExtractedData(result);
      await updateEncounter({ transcript, patient_id: encounter.patient_id });
      await refreshCDS();
    } catch (e) {
      console.error('Extract failed:', e);
    } finally {
      setExtracting(false);
    }
  }

  async function handleGenerateNote() {
    setGenerating(true);
    try {
      const result = await api.generateNote({
        transcript,
        patient_id: encounter.patient_id,
        encounter_id: eid
      });
      if (result.soap_note) {
        setSoapNote(result.soap_note);
        await updateEncounter({ soap_note: result.soap_note, patient_id: encounter.patient_id });
      }
    } catch (e) {
      console.error('Note generation failed:', e);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveTranscript() {
    try {
      await updateEncounter({ transcript, patient_id: encounter.patient_id });
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  }

  async function handleAcceptSuggestion(id) {
    await accept(id);
    await refreshEncounter();
  }

  async function handleRejectSuggestion(id) {
    await reject(id);
  }

  if (loading || !encounter) return <LoadingSpinner message="Loading encounter..." />;

  // Differentials from CDS
  const differentials = suggestions.filter(s => s.suggestion_type === 'differential_diagnosis');
  const clinicalSuggestions = suggestions.filter(s => s.suggestion_type !== 'differential_diagnosis');

  // Orders summary
  const prescriptions = orders?.prescriptions || [];
  const labOrders = orders?.lab_orders || [];
  const imagingOrders = orders?.imaging_orders || [];
  const referrals = orders?.referrals || [];
  const totalOrders = prescriptions.length + labOrders.length + imagingOrders.length + referrals.length;

  return (
    <div className="flex flex-col h-screen">
      {/* Patient Banner */}
      {patient && <PatientBanner patient={patient} />}

      {/* Workflow Bar */}
      <div className="bg-white border-b border-gray-100 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TouchButton variant="secondary" size="sm" onClick={() => navigate('/')}>
            &#x2190; Dashboard
          </TouchButton>
          {workflow?.current_state === 'vitals-recorded' && (
            <TouchButton variant="primary" size="sm" onClick={handleStartExam}>
              Start Exam
            </TouchButton>
          )}
        </div>
        <WorkflowTracker timeline={timeline} currentState={workflow?.current_state} compact />
      </div>

      {/* Three-Panel Layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT PANEL — Patient Summary */}
        <div className="w-72 border-r border-gray-200 bg-gray-50/50 overflow-y-auto clinical-scroll flex-shrink-0">
          <div className="p-3 space-y-3">
            {/* Problems */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1">Problems</h3>
              {patient?.problems && patient.problems.length > 0 ? (
                <div className="space-y-1">
                  {patient.problems.map((p, i) => (
                    <div key={i} className="bg-white rounded-lg p-2 text-sm border border-gray-100">
                      <div className="font-medium text-gray-900">{p.name || p.problem_name}</div>
                      <div className="text-xs text-gray-500">{p.icd10_code}</div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-gray-400 px-1">No active problems</p>}
            </div>

            {/* Medications */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1">Medications</h3>
              {patient?.medications && patient.medications.length > 0 ? (
                <div className="space-y-1">
                  {patient.medications.map((m, i) => (
                    <div key={i} className="bg-white rounded-lg p-2 text-sm border border-gray-100">
                      <div className="font-medium text-gray-900">{m.name || m.medication_name}</div>
                      <div className="text-xs text-gray-500">{m.dosage} {m.frequency}</div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-gray-400 px-1">No medications</p>}
            </div>

            {/* Recent Vitals */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1">Latest Vitals</h3>
              {patient?.vitals && patient.vitals.length > 0 ? (
                <VitalsDisplay vitals={patient.vitals[0]} compact />
              ) : <p className="text-xs text-gray-400 px-1">No vitals recorded</p>}
            </div>

            {/* Recent Labs */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1">Recent Labs</h3>
              {patient?.labs && patient.labs.length > 0 ? (
                <LabResults labs={patient.labs} compact />
              ) : <p className="text-xs text-gray-400 px-1">No lab results</p>}
            </div>
          </div>
        </div>

        {/* CENTER PANEL — Transcript, Extracted Data, SOAP Note, Orders */}
        <div className="flex-1 overflow-y-auto clinical-scroll">
          <div className="max-w-2xl mx-auto p-4 space-y-4">

            {/* Voice Recording */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <span>Encounter Transcript</span>
                  {speech.isListening && (
                    <span className="flex items-center gap-1 text-red-500 text-xs animate-pulse-record">
                      <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                      Recording...
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardBody className="space-y-3">
                <textarea
                  value={transcript}
                  onChange={e => setTranscript(e.target.value)}
                  placeholder="Start recording or type the encounter narrative..."
                  className="w-full border border-gray-300 rounded-xl p-3 text-base min-h-[120px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                  rows={5}
                />
                {/* Live interim text */}
                {speech.isListening && speech.interimTranscript && (
                  <div className="bg-blue-50 rounded-lg p-2 text-sm text-blue-600 italic">
                    {speech.interimTranscript}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {speech.isSupported && (
                    <TouchButton
                      variant={speech.isListening ? 'danger' : 'primary'}
                      size="sm"
                      onClick={speech.isListening ? speech.stopListening : speech.startListening}
                    >
                      {speech.isListening ? '&#x23F9; Stop' : '&#x1F3A4; Record'}
                    </TouchButton>
                  )}
                  <TouchButton variant="secondary" size="sm" onClick={handleExtract} loading={extracting} disabled={!transcript.trim()}>
                    &#x1F50D; Extract Data
                  </TouchButton>
                  <TouchButton variant="secondary" size="sm" onClick={handleGenerateNote} loading={generating} disabled={!transcript.trim()}>
                    &#x1F4DD; Generate Note
                  </TouchButton>
                  <TouchButton variant="secondary" size="sm" onClick={handleSaveTranscript} disabled={!transcript.trim()}>
                    &#x1F4BE; Save
                  </TouchButton>
                </div>
              </CardBody>
            </Card>

            {/* Extracted Data */}
            {extractedData && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <span>Extracted Clinical Data</span>
                    <Badge variant="success">AI Parsed</Badge>
                  </div>
                </CardHeader>
                <CardBody>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {extractedData.vitals && Object.keys(extractedData.vitals).length > 0 && (
                      <div className="bg-blue-50 rounded-lg p-3">
                        <h4 className="text-xs font-semibold text-blue-700 uppercase mb-2">Vitals</h4>
                        {Object.entries(extractedData.vitals).map(([k, v]) => (
                          <div key={k} className="flex justify-between text-sm">
                            <span className="text-gray-600">{k.replace(/_/g, ' ')}</span>
                            <span className="font-medium">{v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {extractedData.medications && extractedData.medications.length > 0 && (
                      <div className="bg-green-50 rounded-lg p-3">
                        <h4 className="text-xs font-semibold text-green-700 uppercase mb-2">Medications</h4>
                        {extractedData.medications.map((m, i) => (
                          <div key={i} className="text-sm mb-1">
                            <span className="font-medium">{m.name || m.medication}</span>
                            {m.dosage && <span className="text-gray-500 ml-1">{m.dosage}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {extractedData.problems && extractedData.problems.length > 0 && (
                      <div className="bg-amber-50 rounded-lg p-3">
                        <h4 className="text-xs font-semibold text-amber-700 uppercase mb-2">Diagnoses</h4>
                        {extractedData.problems.map((p, i) => (
                          <div key={i} className="text-sm mb-1">
                            <span className="font-medium">{p.name || p.problem}</span>
                            {p.icd10 && <span className="text-gray-500 ml-1">({p.icd10})</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {extractedData.labs && extractedData.labs.length > 0 && (
                      <div className="bg-purple-50 rounded-lg p-3">
                        <h4 className="text-xs font-semibold text-purple-700 uppercase mb-2">Lab Orders</h4>
                        {extractedData.labs.map((l, i) => (
                          <div key={i} className="text-sm mb-1">
                            <span className="font-medium">{l.test_name || l.name}</span>
                            {l.cpt_code && <span className="text-gray-500 ml-1">({l.cpt_code})</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardBody>
              </Card>
            )}

            {/* SOAP Note */}
            {soapNote && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <span>SOAP Note</span>
                    <Badge variant="info">Auto-Generated</Badge>
                  </div>
                </CardHeader>
                <CardBody>
                  <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono leading-relaxed">{soapNote}</pre>
                </CardBody>
              </Card>
            )}

            {/* Orders Created */}
            {totalOrders > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <span>Orders</span>
                    <Badge variant="success">{totalOrders}</Badge>
                  </div>
                </CardHeader>
                <CardBody>
                  <div className="space-y-2">
                    {prescriptions.map((rx, i) => (
                      <div key={'rx' + i} className="flex items-center gap-2 bg-green-50 rounded-lg p-2 text-sm">
                        <span>&#x1F48A;</span>
                        <span className="font-medium">{rx.medication_name}</span>
                        <span className="text-gray-500">{rx.dosage} {rx.frequency}</span>
                        <Badge variant="success">Rx</Badge>
                      </div>
                    ))}
                    {labOrders.map((lab, i) => (
                      <div key={'lab' + i} className="flex items-center gap-2 bg-purple-50 rounded-lg p-2 text-sm">
                        <span>&#x1F52C;</span>
                        <span className="font-medium">{lab.test_name}</span>
                        {lab.cpt_code && <span className="text-gray-500">({lab.cpt_code})</span>}
                        <Badge variant="info">Lab</Badge>
                      </div>
                    ))}
                    {imagingOrders.map((img, i) => (
                      <div key={'img' + i} className="flex items-center gap-2 bg-blue-50 rounded-lg p-2 text-sm">
                        <span>&#x1F4F7;</span>
                        <span className="font-medium">{img.modality} - {img.body_part}</span>
                        <Badge variant="info">Imaging</Badge>
                      </div>
                    ))}
                    {referrals.map((ref, i) => (
                      <div key={'ref' + i} className="flex items-center gap-2 bg-amber-50 rounded-lg p-2 text-sm">
                        <span>&#x1F4CB;</span>
                        <span className="font-medium">{ref.specialty}</span>
                        <span className="text-gray-500">{ref.reason}</span>
                        <Badge variant="warning">Referral</Badge>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            )}

            {/* Bottom Action Bar */}
            <div className="flex gap-3 pb-4">
              <TouchButton
                variant="success"
                className="flex-1"
                onClick={() => navigate('/review/' + encounterId)}
                disabled={!soapNote && totalOrders === 0}
              >
                &#x2705; Review &amp; Sign
              </TouchButton>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL — CDS Suggestions & Differentials */}
        <div className="w-80 border-l border-gray-200 bg-gray-50/50 overflow-y-auto clinical-scroll flex-shrink-0">
          <div className="p-3 space-y-3">
            {/* CDS Suggestions */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1 flex items-center justify-between">
                <span>CDS Suggestions</span>
                {pending.length > 0 && (
                  <Badge variant="urgent">{pending.length} pending</Badge>
                )}
              </h3>
              <CDSSuggestionList
                suggestions={clinicalSuggestions}
                onAccept={handleAcceptSuggestion}
                onReject={handleRejectSuggestion}
              />
            </div>

            {/* Differentials */}
            {differentials.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1">
                  &#x1F50D; Differential Diagnoses
                </h3>
                <div className="space-y-1">
                  {differentials.map((d, i) => (
                    <div key={d.id || i} className="bg-white rounded-lg p-2 border border-gray-100">
                      <div className="font-medium text-sm text-gray-900">{d.title}</div>
                      {d.description && (
                        <p className="text-xs text-gray-500 mt-1">{d.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Re-evaluate Button */}
            <div className="pt-2">
              <TouchButton variant="secondary" size="sm" className="w-full" onClick={evaluate}>
                &#x1F504; Re-evaluate CDS
              </TouchButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
