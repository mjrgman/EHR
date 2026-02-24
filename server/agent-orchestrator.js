/**
 * MJR-EHR Agentic Orchestration Layer
 *
 * Multi-agent coordination system for AI-powered clinical workflows.
 * Designed for integration with the AI Lab platform.
 *
 * Agent types:
 * - FrontDesk: Patient intake, scheduling, eligibility, check-in automation
 * - Clinical: Chart preparation, CDS augmentation, documentation assistance
 * - Billing: Claim generation, scrubbing, denial management, payment follow-up
 * - Communication: Message routing, response generation, follow-up automation
 * - Analytics: Quality metrics, population health, provider performance
 *
 * Architecture:
 * - Deterministic routing (not LLM-based) for reliability
 * - Agent tasks are structured, auditable, and cancellable
 * - Human-in-the-loop required for all clinical actions
 * - Integrates with existing rule engine, CDS, workflow, and billing modules
 */

const db = require('./database');

// ==========================================
// DATABASE SCHEMA
// ==========================================

async function initAgentSchema() {
  await db.dbRun(`CREATE TABLE IF NOT EXISTS agent_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_type TEXT NOT NULL CHECK(task_type IN (
      'chart_prep','intake_automation','eligibility_check','cds_evaluation',
      'note_generation','claim_generation','claim_scrub','denial_follow_up',
      'appointment_reminder','lab_result_notification','medication_refill',
      'follow_up_outreach','quality_measure','population_health',
      'message_response','call_triage','general'
    )),
    agent TEXT NOT NULL CHECK(agent IN ('front_desk','clinical','billing','communication','analytics','orchestrator')),
    status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled','awaiting_approval')) DEFAULT 'queued',
    priority INTEGER DEFAULT 50,
    patient_id INTEGER,
    encounter_id INTEGER,
    input_data TEXT,
    output_data TEXT,
    error_message TEXT,
    requires_approval BOOLEAN DEFAULT 0,
    approved_by TEXT,
    approval_time DATETIME,
    started_at DATETIME,
    completed_at DATETIME,
    duration_ms INTEGER,
    parent_task_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
    FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_task_id) REFERENCES agent_tasks(id) ON DELETE SET NULL
  )`);

  await db.dbRun(`CREATE TABLE IF NOT EXISTS agent_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_type TEXT NOT NULL CHECK(session_type IN ('encounter','background','scheduled','on_demand')),
    status TEXT NOT NULL CHECK(status IN ('active','paused','completed','failed')) DEFAULT 'active',
    patient_id INTEGER,
    encounter_id INTEGER,
    active_agents TEXT,
    context_summary TEXT,
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed INTEGER DEFAULT 0,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
    FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
  )`);
}

// ==========================================
// AGENT DEFINITIONS
// ==========================================

const AGENTS = {
  front_desk: {
    name: 'Front Desk Agent',
    description: 'Handles patient intake, scheduling, eligibility verification, and check-in workflows',
    capabilities: ['intake_automation', 'eligibility_check', 'appointment_reminder', 'call_triage'],
    autoApprove: ['eligibility_check', 'appointment_reminder'] // these don't need human approval
  },
  clinical: {
    name: 'Clinical Agent',
    description: 'Manages chart preparation, CDS evaluation, note generation, and clinical documentation',
    capabilities: ['chart_prep', 'cds_evaluation', 'note_generation', 'quality_measure'],
    autoApprove: ['chart_prep', 'cds_evaluation'] // CDS is always suggestions, notes need provider sign-off
  },
  billing: {
    name: 'Billing Agent',
    description: 'Handles claim generation, scrubbing, submission, denial management, and payment posting',
    capabilities: ['claim_generation', 'claim_scrub', 'denial_follow_up'],
    autoApprove: ['claim_scrub'] // scrubbing is informational; generation/submission need approval
  },
  communication: {
    name: 'Communication Agent',
    description: 'Manages outbound messaging, follow-up outreach, and message response generation',
    capabilities: ['lab_result_notification', 'medication_refill', 'follow_up_outreach', 'message_response'],
    autoApprove: [] // all outbound communication needs human review
  },
  analytics: {
    name: 'Analytics Agent',
    description: 'Runs quality measures, population health analysis, and provider performance metrics',
    capabilities: ['quality_measure', 'population_health'],
    autoApprove: ['quality_measure', 'population_health'] // read-only analytics
  }
};

// ==========================================
// TASK EXECUTION ENGINE
// ==========================================

/**
 * Submit a task for agent processing.
 */
async function submitTask(taskType, agentName, data = {}) {
  const agent = AGENTS[agentName];
  if (!agent) throw new Error(`Unknown agent: ${agentName}`);
  if (!agent.capabilities.includes(taskType)) {
    throw new Error(`Agent '${agentName}' cannot handle task type '${taskType}'`);
  }

  const requiresApproval = !agent.autoApprove.includes(taskType);

  const result = await db.dbRun(
    `INSERT INTO agent_tasks
     (task_type, agent, status, priority, patient_id, encounter_id, input_data, requires_approval)
     VALUES (?,?,?,?,?,?,?,?)`,
    [taskType, agentName, 'queued', data.priority || 50,
     data.patientId || null, data.encounterId || null,
     JSON.stringify(data.input || {}), requiresApproval ? 1 : 0]
  );

  const taskId = result.lastID;

  // Auto-execute if no approval needed
  if (!requiresApproval) {
    return executeTask(taskId);
  }

  return {
    taskId,
    status: 'queued',
    requiresApproval: true,
    agent: agentName,
    taskType
  };
}

/**
 * Execute a queued task.
 */
async function executeTask(taskId) {
  const task = await db.dbGet('SELECT * FROM agent_tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Task not found');

  if (task.status !== 'queued' && task.status !== 'awaiting_approval') {
    throw new Error(`Task ${taskId} is in '${task.status}' state, cannot execute`);
  }

  // Mark as running
  await db.dbRun(
    'UPDATE agent_tasks SET status = ?, started_at = CURRENT_TIMESTAMP WHERE id = ?',
    ['running', taskId]
  );

  const startTime = Date.now();
  let output = {};
  let error = null;

  try {
    const input = task.input_data ? JSON.parse(task.input_data) : {};

    switch (task.task_type) {
      case 'chart_prep':
        output = await executeChartPrep(task.patient_id, task.encounter_id);
        break;
      case 'eligibility_check':
        output = await executeEligibilityCheck(task.patient_id);
        break;
      case 'cds_evaluation':
        output = await executeCDSEvaluation(task.patient_id, task.encounter_id);
        break;
      case 'claim_generation':
        output = await executeClaimGeneration(task.encounter_id);
        break;
      case 'claim_scrub':
        output = await executeClaimScrub(input.claimId);
        break;
      case 'appointment_reminder':
        output = await executeAppointmentReminder(task.patient_id, input);
        break;
      case 'quality_measure':
        output = await executeQualityMeasure(task.patient_id);
        break;
      default:
        output = { message: `Task type '${task.task_type}' registered but handler not yet implemented` };
    }
  } catch (err) {
    error = err.message;
  }

  const duration = Date.now() - startTime;

  // Update task
  await db.dbRun(
    `UPDATE agent_tasks SET
       status = ?, output_data = ?, error_message = ?,
       completed_at = CURRENT_TIMESTAMP, duration_ms = ?
     WHERE id = ?`,
    [error ? 'failed' : 'completed', JSON.stringify(output), error, duration, taskId]
  );

  return {
    taskId,
    status: error ? 'failed' : 'completed',
    agent: task.agent,
    taskType: task.task_type,
    duration,
    output: error ? null : output,
    error
  };
}

/**
 * Approve a task that requires human authorization.
 */
async function approveTask(taskId, approvedBy) {
  const task = await db.dbGet('SELECT * FROM agent_tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Task not found');
  if (!task.requires_approval) throw new Error('Task does not require approval');

  await db.dbRun(
    'UPDATE agent_tasks SET approved_by = ?, approval_time = CURRENT_TIMESTAMP WHERE id = ?',
    [approvedBy, taskId]
  );

  return executeTask(taskId);
}

// ==========================================
// TASK HANDLERS
// ==========================================

async function executeChartPrep(patientId, encounterId) {
  if (!patientId) throw new Error('Patient ID required for chart prep');

  const [patient, problems, medications, allergies, labs, vitals, recentEncounters] = await Promise.all([
    db.getPatientById(patientId),
    db.getPatientProblems(patientId),
    db.getPatientMedications(patientId),
    db.getPatientAllergies(patientId),
    db.getPatientLabs(patientId),
    db.getPatientVitals(patientId),
    db.dbAll(
      `SELECT * FROM encounters WHERE patient_id = ? AND status IN ('completed','signed') ORDER BY encounter_date DESC LIMIT 5`,
      [patientId]
    )
  ]);

  const activeProblems = problems.filter(p => p.status === 'active' || p.status === 'chronic');
  const activeMeds = medications.filter(m => m.status === 'active');
  const latestVitals = vitals[0] || null;
  const abnormalLabs = labs.filter(l => l.abnormal_flag && l.abnormal_flag !== 'Normal');

  // Identify care gaps
  const careGaps = [];
  const hasDiabetes = activeProblems.some(p => p.icd10_code?.startsWith('E11'));
  const hasHTN = activeProblems.some(p => p.icd10_code === 'I10');

  if (hasDiabetes) {
    const lastA1C = labs.find(l => l.test_name === 'Hemoglobin A1C');
    if (!lastA1C || monthsSince(lastA1C.result_date) > 3) {
      careGaps.push({ gap: 'A1C overdue', lastDone: lastA1C?.result_date || 'Never', interval: '3 months' });
    }
    const lastUACR = labs.find(l => /microalbumin/i.test(l.test_name));
    if (!lastUACR || monthsSince(lastUACR.result_date) > 12) {
      careGaps.push({ gap: 'UACR screening overdue', lastDone: lastUACR?.result_date || 'Never', interval: '12 months' });
    }
    const lastLipids = labs.find(l => l.test_name === 'Lipid Panel');
    if (!lastLipids || monthsSince(lastLipids.result_date) > 12) {
      careGaps.push({ gap: 'Lipid panel overdue', lastDone: lastLipids?.result_date || 'Never', interval: '12 months' });
    }
  }

  if (hasHTN) {
    const lastBMP = labs.find(l => /metabolic/i.test(l.test_name));
    if (!lastBMP || monthsSince(lastBMP.result_date) > 12) {
      careGaps.push({ gap: 'Metabolic panel overdue (HTN monitoring)', lastDone: lastBMP?.result_date || 'Never', interval: '12 months' });
    }
  }

  return {
    patient: { name: `${patient.first_name} ${patient.last_name}`, age: db.calculateAge(patient.dob), sex: patient.sex },
    summary: {
      active_problems: activeProblems.length,
      active_medications: activeMeds.length,
      allergies: allergies.length,
      abnormal_labs: abnormalLabs.length,
      care_gaps: careGaps.length
    },
    active_problems: activeProblems,
    active_medications: activeMeds,
    allergies,
    latest_vitals: latestVitals,
    abnormal_labs: abnormalLabs,
    care_gaps: careGaps,
    recent_encounters: recentEncounters.map(e => ({
      date: e.encounter_date,
      type: e.encounter_type,
      complaint: e.chief_complaint,
      provider: e.provider
    }))
  };
}

async function executeEligibilityCheck(patientId) {
  const billing = require('./billing-engine');
  return billing.verifyEligibility(patientId);
}

async function executeCDSEvaluation(patientId, encounterId) {
  const cds = require('./cds-engine');
  const llmCds = require('./llm-cds');

  const context = await cds.buildPatientContext(patientId, encounterId);
  const ruleSuggestions = await cds.evaluatePatientContext(encounterId, patientId, context);
  const augmented = await llmCds.augmentedClinicalReasoning(context, ruleSuggestions);

  return augmented;
}

async function executeClaimGeneration(encounterId) {
  const billing = require('./billing-engine');
  return billing.generateClaimFromEncounter(encounterId);
}

async function executeClaimScrub(claimId) {
  const billing = require('./billing-engine');
  return billing.scrubClaim(claimId);
}

async function executeAppointmentReminder(patientId, input) {
  const comms = require('./communications');
  const patient = await db.getPatientById(patientId);
  if (!patient || !patient.phone) throw new Error('Patient phone number not available');

  return comms.sendTemplatedMessage('appointment_reminder_sms', {
    patient_first_name: patient.first_name,
    appointment_date: input.appointmentDate || 'TBD',
    appointment_time: input.appointmentTime || 'TBD',
    provider_name: input.providerName || 'your provider'
  }, { phone: patient.phone }, { patientId });
}

async function executeQualityMeasure(patientId) {
  // HEDIS/MIPS quality measure check
  const patient = await db.getPatientById(patientId);
  const problems = await db.getPatientProblems(patientId);
  const labs = await db.getPatientLabs(patientId);
  const medications = await db.getPatientMedications(patientId);

  const measures = [];
  const hasDiabetes = problems.some(p => p.icd10_code?.startsWith('E11'));
  const hasHTN = problems.some(p => p.icd10_code === 'I10');

  if (hasDiabetes) {
    // NQF 0059: Diabetes: Hemoglobin A1c Poor Control (>9%)
    const lastA1C = labs.find(l => l.test_name === 'Hemoglobin A1C');
    measures.push({
      measure: 'NQF 0059',
      name: 'Diabetes: A1C Control',
      denominator: true,
      numerator: lastA1C && parseFloat(lastA1C.result_value) <= 9.0,
      status: !lastA1C ? 'gap' : (parseFloat(lastA1C.result_value) <= 9.0 ? 'met' : 'not_met'),
      detail: lastA1C ? `A1C: ${lastA1C.result_value}% (${lastA1C.result_date})` : 'No A1C on file'
    });

    // Statin therapy for diabetes
    const onStatin = medications.some(m => /statin|atorvastatin|rosuvastatin|simvastatin/i.test(m.medication_name) && m.status === 'active');
    const age = db.calculateAge(patient.dob);
    if (age >= 40 && age <= 75) {
      measures.push({
        measure: 'NQF 0541',
        name: 'Statin Therapy for Diabetes (40-75)',
        denominator: true,
        numerator: onStatin,
        status: onStatin ? 'met' : 'gap',
        detail: onStatin ? 'Active statin on medication list' : 'No statin prescribed'
      });
    }
  }

  if (hasHTN) {
    // Controlling High Blood Pressure
    const vitals = await db.getPatientVitals(patientId);
    const lastBP = vitals[0];
    const controlled = lastBP && lastBP.systolic_bp < 140 && lastBP.diastolic_bp < 90;
    measures.push({
      measure: 'NQF 0018',
      name: 'Controlling High Blood Pressure',
      denominator: true,
      numerator: controlled,
      status: !lastBP ? 'gap' : (controlled ? 'met' : 'not_met'),
      detail: lastBP ? `Last BP: ${lastBP.systolic_bp}/${lastBP.diastolic_bp}` : 'No BP on file'
    });
  }

  return {
    patient: `${patient.first_name} ${patient.last_name}`,
    measures,
    summary: {
      total: measures.length,
      met: measures.filter(m => m.status === 'met').length,
      not_met: measures.filter(m => m.status === 'not_met').length,
      gaps: measures.filter(m => m.status === 'gap').length
    }
  };
}

// ==========================================
// ORCHESTRATION — ENCOUNTER LIFECYCLE
// ==========================================

/**
 * Trigger the full agent pipeline for an encounter.
 * This is the main orchestration entry point.
 */
async function orchestrateEncounter(encounterId, patientId) {
  // Create session
  const session = await db.dbRun(
    `INSERT INTO agent_sessions (session_type, patient_id, encounter_id, active_agents, context_summary)
     VALUES ('encounter', ?, ?, ?, ?)`,
    [patientId, encounterId, JSON.stringify(['front_desk', 'clinical', 'billing']),
     'Encounter orchestration started']
  );

  const sessionId = session.lastID;
  const results = [];

  // Phase 1: Chart Prep (auto-approved)
  try {
    const chartPrep = await submitTask('chart_prep', 'clinical', { patientId, encounterId, priority: 10 });
    results.push({ phase: 'chart_prep', ...chartPrep });
  } catch (err) {
    results.push({ phase: 'chart_prep', error: err.message });
  }

  // Phase 2: Eligibility Check (auto-approved)
  try {
    const eligibility = await submitTask('eligibility_check', 'front_desk', { patientId, priority: 20 });
    results.push({ phase: 'eligibility', ...eligibility });
  } catch (err) {
    results.push({ phase: 'eligibility', error: err.message });
  }

  // Phase 3: CDS Evaluation (auto-approved)
  try {
    const cds = await submitTask('cds_evaluation', 'clinical', { patientId, encounterId, priority: 30 });
    results.push({ phase: 'cds', ...cds });
  } catch (err) {
    results.push({ phase: 'cds', error: err.message });
  }

  // Phase 4: Quality Measures (auto-approved)
  try {
    const quality = await submitTask('quality_measure', 'analytics', { patientId, priority: 40 });
    results.push({ phase: 'quality', ...quality });
  } catch (err) {
    results.push({ phase: 'quality', error: err.message });
  }

  // Update session
  const completedCount = results.filter(r => r.status === 'completed').length;
  const failedCount = results.filter(r => r.error || r.status === 'failed').length;

  await db.dbRun(
    `UPDATE agent_sessions SET tasks_completed = ?, tasks_failed = ?,
     context_summary = ? WHERE id = ?`,
    [completedCount, failedCount, `Orchestration complete: ${completedCount} succeeded, ${failedCount} failed`, sessionId]
  );

  return {
    sessionId,
    encounterId,
    patientId,
    phases: results,
    summary: { completed: completedCount, failed: failedCount, total: results.length }
  };
}

/**
 * Trigger post-encounter billing pipeline.
 * Requires approval for claim submission.
 */
async function orchestratePostEncounterBilling(encounterId) {
  const results = [];

  // Generate claim (requires approval)
  try {
    const claim = await submitTask('claim_generation', 'billing', { encounterId, priority: 10 });
    results.push({ phase: 'claim_generation', ...claim });

    // If auto-generated (or after approval), scrub it
    if (claim.output?.id) {
      const scrub = await submitTask('claim_scrub', 'billing', {
        input: { claimId: claim.output.id }, priority: 20
      });
      results.push({ phase: 'claim_scrub', ...scrub });
    }
  } catch (err) {
    results.push({ phase: 'billing_pipeline', error: err.message });
  }

  return { encounterId, results };
}

// ==========================================
// QUERY FUNCTIONS
// ==========================================

async function getAgentTasks(filters = {}) {
  let query = 'SELECT * FROM agent_tasks';
  const conditions = [];
  const params = [];

  if (filters.agent) { conditions.push('agent = ?'); params.push(filters.agent); }
  if (filters.status) { conditions.push('status = ?'); params.push(filters.status); }
  if (filters.taskType) { conditions.push('task_type = ?'); params.push(filters.taskType); }
  if (filters.patientId) { conditions.push('patient_id = ?'); params.push(filters.patientId); }
  if (filters.encounterId) { conditions.push('encounter_id = ?'); params.push(filters.encounterId); }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY priority ASC, created_at DESC LIMIT 100';

  const tasks = await db.dbAll(query, params);

  // Parse JSON fields
  for (const t of tasks) {
    try { if (t.input_data) t.input_data = JSON.parse(t.input_data); } catch {}
    try { if (t.output_data) t.output_data = JSON.parse(t.output_data); } catch {}
  }

  return tasks;
}

async function getAgentSessions(status = null) {
  if (status) {
    return db.dbAll('SELECT * FROM agent_sessions WHERE status = ? ORDER BY started_at DESC LIMIT 50', [status]);
  }
  return db.dbAll('SELECT * FROM agent_sessions ORDER BY started_at DESC LIMIT 50');
}

async function getAgentStatus() {
  const [taskCounts, recentTasks, activeSessions] = await Promise.all([
    db.dbAll(
      `SELECT agent, status, COUNT(*) as count
       FROM agent_tasks
       WHERE created_at >= datetime('now', '-24 hours')
       GROUP BY agent, status`
    ),
    db.dbAll(
      `SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT 10`
    ),
    db.dbAll(
      `SELECT * FROM agent_sessions WHERE status = 'active'`
    )
  ]);

  return {
    agents: Object.entries(AGENTS).map(([key, agent]) => ({
      id: key,
      name: agent.name,
      description: agent.description,
      capabilities: agent.capabilities,
      tasks_24h: taskCounts.filter(t => t.agent === key)
    })),
    recent_tasks: recentTasks.map(t => {
      try { if (t.output_data) t.output_data = JSON.parse(t.output_data); } catch {}
      return t;
    }),
    active_sessions: activeSessions,
    summary: {
      total_tasks_24h: taskCounts.reduce((sum, t) => sum + t.count, 0),
      completed_24h: taskCounts.filter(t => t.status === 'completed').reduce((sum, t) => sum + t.count, 0),
      failed_24h: taskCounts.filter(t => t.status === 'failed').reduce((sum, t) => sum + t.count, 0),
      pending_approval: taskCounts.filter(t => t.status === 'awaiting_approval').reduce((sum, t) => sum + t.count, 0)
    }
  };
}

// ==========================================
// HELPERS
// ==========================================

function monthsSince(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  const now = new Date();
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  // Setup
  initAgentSchema,

  // Agent definitions
  AGENTS,

  // Task management
  submitTask,
  executeTask,
  approveTask,

  // Orchestration
  orchestrateEncounter,
  orchestratePostEncounterBilling,

  // Queries
  getAgentTasks,
  getAgentSessions,
  getAgentStatus
};
