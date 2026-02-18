import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePatient } from '../hooks/usePatient';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import PatientBanner from '../components/patient/PatientBanner';
import ProblemList from '../components/patient/ProblemList';
import MedList from '../components/patient/MedList';
import VitalsDisplay from '../components/patient/VitalsDisplay';
import LabResults from '../components/patient/LabResults';
import AllergyBadges from '../components/patient/AllergyBadges';
import LoadingSpinner from '../components/common/LoadingSpinner';
import api from '../api/client';

export default function PatientPage() {
  const { patientId } = useParams();
  const { patient, loading, error } = usePatient(patientId);
  const navigate = useNavigate();

  async function startEncounter() {
    try {
      const enc = await api.createEncounter({ patient_id: parseInt(patientId), encounter_type: 'Office Visit - Follow-up', chief_complaint: '', provider: 'Dr. MJR' });
      navigate('/checkin/' + enc.id);
    } catch (e) { alert('Failed: ' + e.message); }
  }

  if (loading) return <LoadingSpinner message="Loading patient..." />;
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>;
  if (!patient) return <div className="p-4">Patient not found</div>;

  return (
    <div>
      <PatientBanner patient={patient} />
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <TouchButton variant="secondary" size="sm" onClick={() => navigate('/')}>&#x2190; Back</TouchButton>
          <TouchButton variant="primary" onClick={startEncounter}>New Encounter</TouchButton>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card><CardHeader>Problems</CardHeader><CardBody><ProblemList problems={patient.problems} /></CardBody></Card>
          <Card><CardHeader>Medications</CardHeader><CardBody><MedList medications={patient.medications} /></CardBody></Card>
          <Card><CardHeader>Allergies</CardHeader><CardBody><AllergyBadges allergies={patient.allergies} /></CardBody></Card>
          <Card><CardHeader>Latest Vitals</CardHeader><CardBody><VitalsDisplay vitals={patient.vitals} /></CardBody></Card>
          <Card className="md:col-span-2"><CardHeader>Recent Lab Results</CardHeader><CardBody><LabResults labs={patient.labs} /></CardBody></Card>
        </div>
      </div>
    </div>
  );
}
