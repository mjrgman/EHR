const BASE = '/api';

export const safeLog = {
  error: (msg, ...args) => {
    const safeArgs = args.map(a => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') return '[object]';
      return a;
    });
    console.error(msg, ...safeArgs);
  }
};

// Audit session tracking
let auditSessionId = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('audit_session_id') : null;
let auditUser = null;
let auditRole = null;

export function setAuditContext(providerName, role) {
  auditUser = providerName;
  auditRole = role;
}

async function request(url, options = {}, _retryCount = 0) {
  if (!navigator.onLine) {
    throw new Error('Network connection lost. Please check your connection and try again.');
  }

  const auditHeaders = {};
  if (auditSessionId) auditHeaders['X-Audit-Session-Id'] = auditSessionId;
  if (auditUser) auditHeaders['X-Audit-User'] = auditUser;
  if (auditRole) auditHeaders['X-Audit-Role'] = auditRole;

  let res;
  try {
    res = await fetch(`${BASE}${url}`, {
      headers: { 'Content-Type': 'application/json', ...auditHeaders, ...options.headers },
      ...options
    });
  } catch (networkErr) {
    // Retry once on network error with 1-second delay
    if (_retryCount < 1) {
      await new Promise(r => setTimeout(r, 1000));
      return request(url, options, _retryCount + 1);
    }
    throw networkErr;
  }

  // Capture session ID from server response
  const responseSessionId = res.headers.get('X-Audit-Session-Id');
  if (responseSessionId) {
    auditSessionId = responseSessionId;
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('audit_session_id', responseSessionId);
    }
  }

  if (res.status === 401 || res.status === 403) {
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  getPatients: () => request('/patients'),
  getPatient: (id) => request(`/patients/${id}`),
  createPatient: (data) => request('/patients', { method: 'POST', body: JSON.stringify(data) }),
  getEncounters: (params) => { const q = new URLSearchParams(params).toString(); return request(`/encounters${q ? '?' + q : ''}`); },
  getEncounter: (id) => request(`/encounters/${id}`),
  createEncounter: (data) => request('/encounters', { method: 'POST', body: JSON.stringify(data) }),
  updateEncounter: (id, data) => request(`/encounters/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getEncounterOrders: (id) => request(`/encounters/${id}/orders`),
  addVitals: (data) => request('/vitals', { method: 'POST', body: JSON.stringify(data) }),
  addVitalsFromSpeech: (data) => request('/vitals/from-speech', { method: 'POST', body: JSON.stringify(data) }),
  getLabOrders: (params) => { const q = new URLSearchParams(params).toString(); return request(`/lab-orders${q ? '?' + q : ''}`); },
  createLabOrder: (data) => request('/lab-orders', { method: 'POST', body: JSON.stringify(data) }),
  getImagingOrders: (params) => { const q = new URLSearchParams(params).toString(); return request(`/imaging-orders${q ? '?' + q : ''}`); },
  createImagingOrder: (data) => request('/imaging-orders', { method: 'POST', body: JSON.stringify(data) }),
  getReferrals: (params) => { const q = new URLSearchParams(params).toString(); return request(`/referrals${q ? '?' + q : ''}`); },
  createReferral: (data) => request('/referrals', { method: 'POST', body: JSON.stringify(data) }),
  createPrescription: (data) => request('/prescriptions', { method: 'POST', body: JSON.stringify(data) }),
  extractData: (data) => request('/ai/extract-data', { method: 'POST', body: JSON.stringify(data) }),
  generateNote: (data) => request('/ai/generate-note', { method: 'POST', body: JSON.stringify(data) }),
  getWorkflow: (encounterId) => request(`/workflow/${encounterId}`),
  createWorkflow: (data) => request('/workflow', { method: 'POST', body: JSON.stringify(data) }),
  transitionWorkflow: (encounterId, data) => request(`/workflow/${encounterId}/transition`, { method: 'POST', body: JSON.stringify(data) }),
  getTimeline: (encounterId) => request(`/workflow/${encounterId}/timeline`),
  getQueue: (state) => request(`/workflow/queue/${state}`),
  getAllWorkflows: () => request('/workflows'),
  evaluateCDS: (data) => request('/cds/evaluate', { method: 'POST', body: JSON.stringify(data) }),
  getSuggestions: (encounterId, status) => { const q = status ? `?status=${status}` : ''; return request(`/cds/suggestions/${encounterId}${q}`); },
  acceptSuggestion: (id, data) => request(`/cds/suggestions/${id}/accept`, { method: 'POST', body: JSON.stringify(data) }),
  rejectSuggestion: (id, data) => request(`/cds/suggestions/${id}/reject`, { method: 'POST', body: JSON.stringify(data) }),
  deferSuggestion: (id) => request(`/cds/suggestions/${id}/defer`, { method: 'POST', body: JSON.stringify({}) }),
  getProviderPreferences: (provider) => request(`/provider/preferences?provider=${encodeURIComponent(provider)}`),
  getDashboard: () => request('/dashboard'),
  getHealth: () => request('/health'),

  // Audit endpoints
  getAuditLogs: (params) => { const q = new URLSearchParams(params).toString(); return request(`/audit/logs${q ? '?' + q : ''}`); },
  getAuditStats: (params) => { const q = new URLSearchParams(params).toString(); return request(`/audit/stats${q ? '?' + q : ''}`); },
  getAuditSessions: (params) => { const q = new URLSearchParams(params).toString(); return request(`/audit/sessions${q ? '?' + q : ''}`); },
  getPatientAuditTrail: (patientId) => request(`/audit/patient/${patientId}`),

  // Scheduling endpoints
  getSchedule: (params) => { const q = new URLSearchParams(params).toString(); return request(`/schedule${q ? '?' + q : ''}`); },
  getPatientAppointments: (patientId) => request(`/patients/${patientId}/appointments`),
  getAppointment: (id) => request(`/appointments/${id}`),
  createAppointment: (data) => request('/appointments', { method: 'POST', body: JSON.stringify(data) }),
  updateAppointment: (id, data) => request(`/appointments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAppointment: (id) => request(`/appointments/${id}`, { method: 'DELETE' }),

  // Billing endpoints
  getCharge: (encounterId) => request(`/encounters/${encounterId}/charge`),
  updateCharge: (encounterId, data) => request(`/encounters/${encounterId}/charge`, { method: 'POST', body: JSON.stringify(data) }),
  finalizeCheckout: (encounterId, data) => request(`/encounters/${encounterId}/checkout`, { method: 'POST', body: JSON.stringify(data) }),
  getBillingCharges: (params) => { const q = new URLSearchParams(params).toString(); return request(`/billing/charges${q ? '?' + q : ''}`); },

  // Patient sub-resources
  addProblem: (patientId, data) => request(`/patients/${patientId}/problems`, { method: 'POST', body: JSON.stringify(data) }),
  addMedication: (patientId, data) => request(`/patients/${patientId}/medications`, { method: 'POST', body: JSON.stringify(data) }),
  addAllergy: (patientId, data) => request(`/patients/${patientId}/allergies`, { method: 'POST', body: JSON.stringify(data) }),

  // Agent endpoints
  runAgentPipeline: (data) => request('/agents/run', { method: 'POST', body: JSON.stringify(data) }),
  getAgentBriefing: (patientId, encounterId) => request(`/agents/briefing/${patientId}${encounterId ? '?encounter_id=' + encounterId : ''}`),
  runMAAgent: (data) => request('/agents/ma', { method: 'POST', body: JSON.stringify(data) }),
};

export default api;
