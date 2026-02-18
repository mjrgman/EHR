import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { usePatient } from '../hooks/usePatient';
import { useWorkflow } from '../hooks/useWorkflow';
import { useEncounter } from '../hooks/useEncounter';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import Badge from '../components/common/Badge';
import PatientBanner from '../components/patient/PatientBanner';
import WorkflowTracker from '../components/workflow/WorkflowTracker';
import LoadingSpinner from '../components/common/LoadingSpinner';

export default function ReviewPage() {
  const { encounterId } = useParams();
  const eid = parseInt(encounterId);
  const navigate = useNavigate();
  const [signing, setSigning] = useState(false);

  const { encounter, orders, refresh: refreshEncounter } = useEncounter(eid);
  const { patient } = usePatient(encounter?.patient_id);
  const { workflow, timeline, transition } = useWorkflow(eid);

  async function handleSign() {
    setSigning(true);
    try {
      // Transition through documentation -> signed
      const state = workflow?.current_state;
      if (state === 'provider-examining' || state === 'orders-pending') {
        try { await transition('orders-pending'); } catch(e) {}
        try { await transition('documentation'); } catch(e) {}
      }
      if (state === 'documentation' || state === 'orders-pending') {
        try { await transition('documentation'); } catch(e) {}
      }
      try { await transition('signed'); } catch(e) {}

      await api.updateEncounter(encounterId, { status: 'signed' });
      navigate('/checkout/' + encounterId);
    } catch (err) {
      // Try to navigate even on error since we may have partially transitioned
      navigate('/checkout/' + encounterId);
    } finally {
      setSigning(false);
    }
  }

  if (!encounter) return <LoadingSpinner message="Loading review..." />;

  const totalOrders = orders ? (orders.lab_orders?.length || 0) + (orders.imaging_orders?.length || 0) +
    (orders.referrals?.length || 0) + (orders.prescriptions?.length || 0) : 0;

  return (
    <div>
      {patient && <PatientBanner patient={patient} />}

      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <TouchButton variant="secondary" size="sm" onClick={() => navigate('/encounter/' + encounterId)}>
            ← Back to Encounter
          </TouchButton>
          <WorkflowTracker timeline={timeline} currentState={workflow?.current_state} />
        </div>

        {/* SOAP Note Review */}
        {encounter.soap_note && (
          <Card>
            <CardHeader>SOAP Note</CardHeader>
            <CardBody>
              <pre className="whitespace-pre-wrap text-sm font-mono text-gray-800 leading-relaxed">
                {encounter.soap_note}
              </pre>
            </CardBody>
          </Card>
        )}

        {/* Orders Summary */}
        <Card>
          <CardHeader>Orders Summary ({totalOrders} total)</CardHeader>
          <CardBody className="space-y-3">
            {(!orders || totalOrders === 0) && (
              <p className="text-sm text-gray-400 italic">No orders created for this encounter.</p>
            )}

            {orders?.prescriptions?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Prescriptions</h4>
                {orders.prescriptions.map((rx, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm py-1 border-b border-gray-50 last:border-0">
                    <Badge variant="success">Rx</Badge>
                    <span className="font-medium">{rx.medication_name}</span>
                    <span className="text-gray-500">{rx.dose} {rx.route} {rx.frequency}</span>
                    <span className="text-gray-400 text-xs ml-auto">{rx.status}</span>
                  </div>
                ))}
              </div>
            )}

            {orders?.lab_orders?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Lab Orders</h4>
                {orders.lab_orders.map((lab, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm py-1 border-b border-gray-50 last:border-0">
                    <Badge variant="routine">Lab</Badge>
                    <span className="font-medium">{lab.test_name}</span>
                    {lab.cpt_code && <span className="text-gray-400 text-xs">CPT: {lab.cpt_code}</span>}
                    <span className="text-gray-400 text-xs ml-auto">{lab.priority}</span>
                  </div>
                ))}
              </div>
            )}

            {orders?.imaging_orders?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Imaging Orders</h4>
                {orders.imaging_orders.map((img, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm py-1 border-b border-gray-50 last:border-0">
                    <Badge variant="purple">Imaging</Badge>
                    <span className="font-medium">{img.study_type}</span>
                    <span className="text-gray-500">{img.body_part}</span>
                  </div>
                ))}
              </div>
            )}

            {orders?.referrals?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Referrals</h4>
                {orders.referrals.map((ref, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm py-1 border-b border-gray-50 last:border-0">
                    <Badge variant="warning">Referral</Badge>
                    <span className="font-medium">{ref.specialty}</span>
                    <span className="text-gray-500">{ref.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Sign Button */}
        <div className="flex gap-3">
          <TouchButton
            variant="secondary"
            onClick={() => navigate('/encounter/' + encounterId)}
            className="flex-1"
          >
            ← Continue Editing
          </TouchButton>
          <TouchButton
            variant="success"
            onClick={handleSign}
            loading={signing}
            className="flex-1"
            icon="✍️"
          >
            Sign Encounter
          </TouchButton>
        </div>
      </div>
    </div>
  );
}
