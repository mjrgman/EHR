/**
 * MJR-EHR Workflow State Machine
 * Manages encounter workflow from scheduling through checkout.
 */

const db = require('./database');

const STATES = {
  'scheduled':          { next: ['checked-in'], role: 'reception', timeField: null },
  'checked-in':         { next: ['roomed'], role: 'ma', timeField: 'check_in_time' },
  'roomed':             { next: ['vitals-recorded'], role: 'ma', timeField: 'roomed_time' },
  'vitals-recorded':    { next: ['provider-examining'], role: 'provider', timeField: 'vitals_time' },
  'provider-examining': { next: ['orders-pending', 'documentation'], role: 'provider', timeField: 'provider_start_time' },
  'orders-pending':     { next: ['documentation'], role: 'provider', timeField: null },
  'documentation':      { next: ['signed'], role: 'provider', timeField: null },
  'signed':             { next: ['checked-out'], role: 'reception', timeField: 'signed_time' },
  'checked-out':        { next: [], role: null, timeField: 'checkout_time' }
};

async function createWorkflow(encounterId, patientId, metadata = {}) {
  const result = await db.createWorkflow({
    encounter_id: encounterId,
    patient_id: patientId,
    assigned_ma: metadata.assigned_ma || null,
    assigned_provider: metadata.assigned_provider || null
  });
  return { id: result.id, state: 'scheduled', encounter_id: encounterId };
}

async function getCurrentState(encounterId) {
  const wf = await db.getWorkflowState(encounterId);
  if (!wf) throw new Error(`No workflow found for encounter ${encounterId}`);
  return wf;
}

function getValidTransitions(currentState) {
  const config = STATES[currentState];
  if (!config) return [];
  return config.next;
}

async function transitionState(encounterId, targetState, metadata = {}) {
  const wf = await getCurrentState(encounterId);
  const config = STATES[wf.current_state];

  if (!config || !config.next.includes(targetState)) {
    throw new Error(`Invalid transition: ${wf.current_state} -> ${targetState}. Valid: ${config ? config.next.join(', ') : 'none'}`);
  }

  const updates = { current_state: targetState };

  // Set the timestamp for the state we're entering
  const targetConfig = STATES[targetState];
  if (targetConfig && targetConfig.timeField) {
    updates[targetConfig.timeField] = new Date().toISOString();
  }

  // Merge any metadata
  if (metadata.assigned_ma) updates.assigned_ma = metadata.assigned_ma;
  if (metadata.assigned_provider) updates.assigned_provider = metadata.assigned_provider;

  await db.updateWorkflowState(encounterId, updates);

  return {
    encounter_id: encounterId,
    previous_state: wf.current_state,
    current_state: targetState,
    timestamp: new Date().toISOString(),
    valid_transitions: getValidTransitions(targetState)
  };
}

async function getWorkflowTimeline(encounterId) {
  const wf = await getCurrentState(encounterId);
  const timeline = [];
  const stateOrder = ['scheduled', 'checked-in', 'roomed', 'vitals-recorded',
    'provider-examining', 'orders-pending', 'documentation', 'signed', 'checked-out'];

  for (const state of stateOrder) {
    const config = STATES[state];
    const entry = {
      state,
      role: config.role,
      status: 'pending'
    };

    if (state === wf.current_state) {
      entry.status = 'current';
    } else if (stateOrder.indexOf(state) < stateOrder.indexOf(wf.current_state)) {
      entry.status = 'completed';
      if (config.timeField && wf[config.timeField]) {
        entry.timestamp = wf[config.timeField];
      }
    }

    timeline.push(entry);
  }

  return { encounter_id: encounterId, current_state: wf.current_state, timeline };
}

async function getQueue(state) {
  return db.getEncountersByState(state);
}

async function getAllWorkflows() {
  return db.getAllWorkflows();
}

module.exports = {
  STATES,
  createWorkflow,
  getCurrentState,
  getValidTransitions,
  transitionState,
  getWorkflowTimeline,
  getQueue,
  getAllWorkflows
};
