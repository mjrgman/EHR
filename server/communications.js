/**
 * MJR-EHR Communications Integration Layer
 *
 * Unified communication platform replacing separate phone/SMS/messaging systems.
 * Integrates telephony, SMS, video, and secure messaging into the EHR workflow.
 *
 * Supported providers (abstracted):
 * - Twilio (telephony, SMS, video)
 * - Vonage/Nexmo (alternative telephony)
 * - SendGrid (email)
 * - Browser WebRTC (video visits)
 *
 * All communications are:
 * - Logged against the patient record
 * - Available for AI analysis and response suggestion
 * - Routable based on patient context and urgency
 */

const db = require('./database');

// ==========================================
// CONFIGURATION
// ==========================================

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const PRACTICE_NAME = process.env.PRACTICE_NAME || 'MJR Health Systems';
const PRACTICE_PHONE = process.env.PRACTICE_PHONE || '478-555-0100';

function isTwilioConfigured() {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER);
}

function isSendgridConfigured() {
  return !!SENDGRID_API_KEY;
}

// ==========================================
// DATABASE SCHEMA (added to main DB)
// ==========================================

async function initCommunicationsSchema() {
  await db.dbRun(`CREATE TABLE IF NOT EXISTS communication_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    encounter_id INTEGER,
    channel TEXT NOT NULL CHECK(channel IN ('phone','sms','email','video','secure_message','fax')),
    direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
    status TEXT NOT NULL CHECK(status IN ('initiated','ringing','in-progress','completed','failed','missed','voicemail','queued','sent','delivered','read')) DEFAULT 'initiated',
    from_number TEXT,
    to_number TEXT,
    from_name TEXT,
    to_name TEXT,
    subject TEXT,
    body TEXT,
    duration_seconds INTEGER,
    recording_url TEXT,
    ai_summary TEXT,
    ai_suggested_response TEXT,
    staff_member TEXT,
    tags TEXT,
    external_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
    FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
  )`);

  await db.dbRun(`CREATE TABLE IF NOT EXISTS message_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    channel TEXT NOT NULL CHECK(channel IN ('sms','email','secure_message','voice')),
    category TEXT NOT NULL CHECK(category IN ('appointment','lab_results','medication','billing','general','follow_up','reminder')),
    subject TEXT,
    body TEXT NOT NULL,
    variables TEXT,
    active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.dbRun(`CREATE TABLE IF NOT EXISTS call_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    caller_phone TEXT,
    caller_name TEXT,
    reason TEXT,
    urgency TEXT CHECK(urgency IN ('routine','urgent','emergency')) DEFAULT 'routine',
    status TEXT CHECK(status IN ('waiting','assigned','in-progress','completed','abandoned')) DEFAULT 'waiting',
    assigned_to TEXT,
    ai_triage_notes TEXT,
    wait_time_seconds INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL
  )`);

  // Seed default message templates
  const existing = await db.dbGet('SELECT COUNT(*) as count FROM message_templates');
  if (existing.count === 0) {
    await seedMessageTemplates();
  }
}

async function seedMessageTemplates() {
  const templates = [
    {
      name: 'appointment_reminder_sms',
      channel: 'sms',
      category: 'appointment',
      subject: null,
      body: 'Hi {{patient_first_name}}, this is {{practice_name}}. Reminder: You have an appointment on {{appointment_date}} at {{appointment_time}} with {{provider_name}}. Reply C to confirm or call {{practice_phone}} to reschedule.',
      variables: JSON.stringify(['patient_first_name', 'practice_name', 'appointment_date', 'appointment_time', 'provider_name', 'practice_phone'])
    },
    {
      name: 'appointment_reminder_email',
      channel: 'email',
      category: 'appointment',
      subject: 'Appointment Reminder - {{practice_name}}',
      body: 'Dear {{patient_first_name}},\n\nThis is a reminder of your upcoming appointment:\n\nDate: {{appointment_date}}\nTime: {{appointment_time}}\nProvider: {{provider_name}}\nLocation: {{practice_address}}\n\nPlease arrive 15 minutes early. Bring your insurance card and photo ID.\n\nTo reschedule, call {{practice_phone}} or reply to this email.\n\nThank you,\n{{practice_name}}',
      variables: JSON.stringify(['patient_first_name', 'practice_name', 'appointment_date', 'appointment_time', 'provider_name', 'practice_address', 'practice_phone'])
    },
    {
      name: 'lab_results_ready_sms',
      channel: 'sms',
      category: 'lab_results',
      subject: null,
      body: 'Hi {{patient_first_name}}, your lab results from {{lab_date}} are available. Please log in to your patient portal or call {{practice_phone}} to discuss with your provider.',
      variables: JSON.stringify(['patient_first_name', 'lab_date', 'practice_phone'])
    },
    {
      name: 'medication_refill_reminder',
      channel: 'sms',
      category: 'medication',
      subject: null,
      body: 'Hi {{patient_first_name}}, your {{medication_name}} prescription may need a refill soon. Contact {{practice_phone}} if you need a renewal.',
      variables: JSON.stringify(['patient_first_name', 'medication_name', 'practice_phone'])
    },
    {
      name: 'follow_up_reminder',
      channel: 'sms',
      category: 'follow_up',
      subject: null,
      body: 'Hi {{patient_first_name}}, this is {{practice_name}}. Dr. {{provider_name}} recommends scheduling a follow-up visit. Please call {{practice_phone}} to book.',
      variables: JSON.stringify(['patient_first_name', 'practice_name', 'provider_name', 'practice_phone'])
    },
    {
      name: 'no_show_follow_up',
      channel: 'sms',
      category: 'appointment',
      subject: null,
      body: 'Hi {{patient_first_name}}, we missed you at your appointment today. Please call {{practice_phone}} to reschedule. Your health is important to us!',
      variables: JSON.stringify(['patient_first_name', 'practice_phone'])
    },
    {
      name: 'billing_statement',
      channel: 'email',
      category: 'billing',
      subject: 'Account Statement - {{practice_name}}',
      body: 'Dear {{patient_first_name}},\n\nYour account statement is ready. Current balance: ${{balance}}.\n\nDate of service: {{dos}}\nInsurance processed: {{insurance_status}}\n\nTo make a payment or set up a payment plan, visit {{portal_url}} or call {{practice_phone}}.\n\nThank you,\n{{practice_name}}',
      variables: JSON.stringify(['patient_first_name', 'practice_name', 'balance', 'dos', 'insurance_status', 'portal_url', 'practice_phone'])
    },
    {
      name: 'telehealth_link',
      channel: 'sms',
      category: 'appointment',
      subject: null,
      body: 'Hi {{patient_first_name}}, your telehealth visit with {{provider_name}} starts at {{appointment_time}}. Join here: {{video_link}}',
      variables: JSON.stringify(['patient_first_name', 'provider_name', 'appointment_time', 'video_link'])
    }
  ];

  for (const t of templates) {
    await db.dbRun(
      `INSERT OR IGNORE INTO message_templates (name, channel, category, subject, body, variables) VALUES (?,?,?,?,?,?)`,
      [t.name, t.channel, t.category, t.subject, t.body, t.variables]
    );
  }
}

// ==========================================
// SMS / MESSAGING
// ==========================================

/**
 * Send an SMS message.
 * Logs to communication_log regardless of provider availability.
 */
async function sendSMS(to, body, options = {}) {
  const logEntry = {
    patient_id: options.patientId || null,
    encounter_id: options.encounterId || null,
    channel: 'sms',
    direction: 'outbound',
    from_number: TWILIO_PHONE_NUMBER || PRACTICE_PHONE,
    to_number: to,
    from_name: PRACTICE_NAME,
    to_name: options.patientName || null,
    body: body,
    staff_member: options.staffMember || 'System',
    tags: options.tags || null
  };

  if (isTwilioConfigured()) {
    try {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      const authHeader = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

      const response = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          To: to,
          From: TWILIO_PHONE_NUMBER,
          Body: body
        })
      });

      if (response.ok) {
        const data = await response.json();
        logEntry.status = 'sent';
        logEntry.external_id = data.sid;
      } else {
        logEntry.status = 'failed';
        console.error('Twilio SMS error:', response.status);
      }
    } catch (err) {
      logEntry.status = 'failed';
      console.error('Twilio SMS exception:', err.message);
    }
  } else {
    // Queue for later or log as pending
    logEntry.status = 'queued';
    console.log(`[SMS QUEUED] To: ${to} | Body: ${body.substring(0, 50)}...`);
  }

  // Always log the communication
  const result = await logCommunication(logEntry);
  return { ...logEntry, id: result.id };
}

/**
 * Send a templated message.
 */
async function sendTemplatedMessage(templateName, variables, recipient, options = {}) {
  const template = await db.dbGet('SELECT * FROM message_templates WHERE name = ? AND active = 1', [templateName]);
  if (!template) {
    throw new Error(`Template '${templateName}' not found or inactive`);
  }

  // Replace variables in template
  let body = template.body;
  let subject = template.subject || '';

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    body = body.split(placeholder).join(value || '');
    subject = subject.split(placeholder).join(value || '');
  }

  // Also replace practice defaults
  body = body.split('{{practice_name}}').join(PRACTICE_NAME);
  body = body.split('{{practice_phone}}').join(PRACTICE_PHONE);
  subject = subject.split('{{practice_name}}').join(PRACTICE_NAME);

  switch (template.channel) {
    case 'sms':
      return sendSMS(recipient.phone, body, { ...options, tags: template.category });
    case 'email':
      return sendEmail(recipient.email, subject, body, { ...options, tags: template.category });
    default:
      throw new Error(`Unsupported template channel: ${template.channel}`);
  }
}

// ==========================================
// EMAIL
// ==========================================

async function sendEmail(to, subject, body, options = {}) {
  const logEntry = {
    patient_id: options.patientId || null,
    encounter_id: options.encounterId || null,
    channel: 'email',
    direction: 'outbound',
    from_name: PRACTICE_NAME,
    to_name: options.patientName || null,
    to_number: to, // reusing field for email address
    subject: subject,
    body: body,
    staff_member: options.staffMember || 'System',
    tags: options.tags || null
  };

  if (isSendgridConfigured()) {
    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SENDGRID_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: process.env.FROM_EMAIL || 'noreply@mjrhealthsystems.com', name: PRACTICE_NAME },
          subject: subject,
          content: [{ type: 'text/plain', value: body }]
        })
      });

      logEntry.status = response.ok ? 'sent' : 'failed';
    } catch (err) {
      logEntry.status = 'failed';
      console.error('SendGrid email error:', err.message);
    }
  } else {
    logEntry.status = 'queued';
    console.log(`[EMAIL QUEUED] To: ${to} | Subject: ${subject}`);
  }

  const result = await logCommunication(logEntry);
  return { ...logEntry, id: result.id };
}

// ==========================================
// CALL MANAGEMENT
// ==========================================

/**
 * Log an inbound call (from telephony webhook or manual entry).
 */
async function logInboundCall(callerPhone, options = {}) {
  // Try to match caller to patient
  let patientId = options.patientId || null;
  if (!patientId && callerPhone) {
    const cleanPhone = callerPhone.replace(/\D/g, '').slice(-10);
    const patient = await db.dbGet(
      'SELECT id, first_name, last_name FROM patients WHERE REPLACE(REPLACE(REPLACE(phone, "-", ""), " ", ""), "(", "") LIKE ?',
      [`%${cleanPhone}`]
    );
    if (patient) {
      patientId = patient.id;
    }
  }

  const logEntry = {
    patient_id: patientId,
    channel: 'phone',
    direction: 'inbound',
    from_number: callerPhone,
    to_number: PRACTICE_PHONE,
    from_name: options.callerName || null,
    to_name: PRACTICE_NAME,
    status: 'ringing',
    staff_member: options.assignedTo || null,
    tags: options.tags || null
  };

  const result = await logCommunication(logEntry);

  // Add to call queue
  await db.dbRun(
    `INSERT INTO call_queue (patient_id, caller_phone, caller_name, reason, urgency)
     VALUES (?, ?, ?, ?, ?)`,
    [patientId, callerPhone, options.callerName, options.reason || 'General inquiry', options.urgency || 'routine']
  );

  return { ...logEntry, id: result.id, patientId };
}

/**
 * Route an inbound call based on patient context and AI triage.
 */
async function triageCall(callId, callerPhone) {
  // Look up patient
  const cleanPhone = callerPhone.replace(/\D/g, '').slice(-10);
  const patient = await db.dbGet(
    `SELECT p.*,
       (SELECT COUNT(*) FROM encounters WHERE patient_id = p.id AND status = 'in-progress') as active_encounters
     FROM patients p
     WHERE REPLACE(REPLACE(REPLACE(phone, "-", ""), " ", ""), "(", "") LIKE ?`,
    [`%${cleanPhone}`]
  );

  const triage = {
    callId,
    callerPhone,
    patient: patient || null,
    urgency: 'routine',
    suggestedRoute: 'front_desk',
    context: [],
    aiNotes: ''
  };

  if (patient) {
    // Check for active encounters
    if (patient.active_encounters > 0) {
      triage.suggestedRoute = 'assigned_provider';
      triage.context.push('Patient has active encounter(s)');
    }

    // Check recent lab results
    const recentLabs = await db.dbAll(
      'SELECT * FROM labs WHERE patient_id = ? AND result_date >= date("now", "-7 days") AND abnormal_flag IS NOT NULL',
      [patient.id]
    );
    if (recentLabs.length > 0) {
      triage.context.push(`${recentLabs.length} abnormal lab result(s) in past 7 days`);
      triage.urgency = 'routine';
    }

    // Check recent medications (new starts in last 14 days)
    const recentMeds = await db.dbAll(
      'SELECT * FROM medications WHERE patient_id = ? AND start_date >= date("now", "-14 days") AND status = "active"',
      [patient.id]
    );
    if (recentMeds.length > 0) {
      triage.context.push(`${recentMeds.length} new medication(s) started in past 14 days`);
    }

    // Build AI triage notes
    const problems = await db.getPatientProblems(patient.id);
    const activeProblems = problems.filter(p => p.status === 'active' || p.status === 'chronic');
    triage.aiNotes = `Known patient: ${patient.first_name} ${patient.last_name}. ` +
      `Active conditions: ${activeProblems.map(p => p.problem_name).join(', ') || 'None'}. ` +
      triage.context.join('. ');
  } else {
    triage.aiNotes = 'Unknown caller — no matching patient in system. Route to front desk for new patient intake or general inquiry.';
  }

  // Update call queue with triage info
  await db.dbRun(
    `UPDATE call_queue SET ai_triage_notes = ?, urgency = ? WHERE id = (
      SELECT id FROM call_queue WHERE caller_phone = ? ORDER BY created_at DESC LIMIT 1
    )`,
    [triage.aiNotes, triage.urgency, callerPhone]
  );

  return triage;
}

/**
 * Get the current call queue.
 */
async function getCallQueue(status = null) {
  if (status) {
    return db.dbAll(
      `SELECT cq.*, p.first_name, p.last_name, p.mrn
       FROM call_queue cq LEFT JOIN patients p ON cq.patient_id = p.id
       WHERE cq.status = ? ORDER BY
         CASE cq.urgency WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
         cq.created_at ASC`,
      [status]
    );
  }
  return db.dbAll(
    `SELECT cq.*, p.first_name, p.last_name, p.mrn
     FROM call_queue cq LEFT JOIN patients p ON cq.patient_id = p.id
     WHERE cq.status IN ('waiting', 'assigned', 'in-progress')
     ORDER BY
       CASE cq.urgency WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
       cq.created_at ASC`
  );
}

// ==========================================
// VIDEO VISIT / TELEHEALTH
// ==========================================

/**
 * Create a video visit session.
 * Returns connection details for WebRTC or Twilio Video.
 */
async function createVideoSession(encounterId, patientId, options = {}) {
  const session = {
    encounterId,
    patientId,
    sessionId: generateSessionId(),
    createdAt: new Date().toISOString(),
    provider: options.provider || 'webrtc',
    status: 'waiting'
  };

  if (isTwilioConfigured() && options.provider === 'twilio') {
    // Generate Twilio Video room (would need Twilio Video SDK)
    session.roomName = `encounter-${encounterId}-${Date.now()}`;
    session.provider = 'twilio_video';
  } else {
    // WebRTC signaling — generate session info
    session.provider = 'webrtc';
    session.signalingData = {
      roomId: session.sessionId,
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };
  }

  // Log the video session start
  await logCommunication({
    patient_id: patientId,
    encounter_id: encounterId,
    channel: 'video',
    direction: 'outbound',
    status: 'initiated',
    body: `Video visit session created: ${session.sessionId}`,
    staff_member: options.providerName || 'Provider',
    external_id: session.sessionId
  });

  return session;
}

// ==========================================
// COMMUNICATION LOG
// ==========================================

async function logCommunication(entry) {
  return db.dbRun(
    `INSERT INTO communication_log
     (patient_id, encounter_id, channel, direction, status, from_number, to_number,
      from_name, to_name, subject, body, duration_seconds, recording_url,
      ai_summary, ai_suggested_response, staff_member, tags, external_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [entry.patient_id, entry.encounter_id, entry.channel, entry.direction,
     entry.status || 'initiated', entry.from_number, entry.to_number,
     entry.from_name, entry.to_name, entry.subject, entry.body,
     entry.duration_seconds, entry.recording_url,
     entry.ai_summary, entry.ai_suggested_response,
     entry.staff_member, entry.tags, entry.external_id]
  ).then(r => ({ id: r.lastID }));
}

/**
 * Get communication history for a patient.
 */
async function getPatientCommunications(patientId, options = {}) {
  const limit = options.limit || 50;
  const channel = options.channel || null;

  if (channel) {
    return db.dbAll(
      `SELECT * FROM communication_log WHERE patient_id = ? AND channel = ? ORDER BY created_at DESC LIMIT ?`,
      [patientId, channel, limit]
    );
  }
  return db.dbAll(
    `SELECT * FROM communication_log WHERE patient_id = ? ORDER BY created_at DESC LIMIT ?`,
    [patientId, limit]
  );
}

/**
 * Get all recent communications.
 */
async function getRecentCommunications(limit = 50) {
  return db.dbAll(
    `SELECT cl.*, p.first_name, p.last_name, p.mrn
     FROM communication_log cl
     LEFT JOIN patients p ON cl.patient_id = p.id
     ORDER BY cl.created_at DESC LIMIT ?`,
    [limit]
  );
}

/**
 * Get all message templates.
 */
async function getMessageTemplates(category = null) {
  if (category) {
    return db.dbAll('SELECT * FROM message_templates WHERE category = ? AND active = 1 ORDER BY name', [category]);
  }
  return db.dbAll('SELECT * FROM message_templates WHERE active = 1 ORDER BY category, name');
}

// ==========================================
// AI-ASSISTED RESPONSES
// ==========================================

/**
 * Generate AI-suggested response for an inbound message.
 * Uses patient context to craft appropriate reply.
 */
async function generateSuggestedResponse(communicationId) {
  const comm = await db.dbGet('SELECT * FROM communication_log WHERE id = ?', [communicationId]);
  if (!comm) return null;

  let suggestion = '';

  if (comm.patient_id) {
    const patient = await db.getPatientById(comm.patient_id);
    const problems = await db.getPatientProblems(comm.patient_id);

    // Simple pattern-based response suggestion
    const body = (comm.body || '').toLowerCase();

    if (/refill|medication|prescription|rx/i.test(body)) {
      suggestion = `Hi ${patient?.first_name || 'there'}, I've forwarded your medication refill request to your provider. You should receive a response within 24-48 hours. If urgent, please call ${PRACTICE_PHONE}.`;
    } else if (/appointment|schedule|book|reschedule/i.test(body)) {
      suggestion = `Hi ${patient?.first_name || 'there'}, I'd be happy to help with scheduling. Our next available appointments are [check schedule]. Please call ${PRACTICE_PHONE} or reply with your preferred date/time.`;
    } else if (/result|lab|test/i.test(body)) {
      suggestion = `Hi ${patient?.first_name || 'there'}, your provider will review your results and follow up with you. For urgent concerns, please call ${PRACTICE_PHONE}.`;
    } else if (/bill|payment|balance|charge|statement/i.test(body)) {
      suggestion = `Hi ${patient?.first_name || 'there'}, for billing questions please call our billing department at ${PRACTICE_PHONE}. We offer payment plans for your convenience.`;
    } else if (/urgent|emergency|pain|worse|er|hospital/i.test(body)) {
      suggestion = `If this is a medical emergency, please call 911 or go to the nearest emergency room. For urgent but non-emergency concerns, call ${PRACTICE_PHONE} to speak with the on-call provider.`;
    } else {
      suggestion = `Hi ${patient?.first_name || 'there'}, thank you for reaching out to ${PRACTICE_NAME}. A team member will respond to your message shortly. For immediate assistance, call ${PRACTICE_PHONE}.`;
    }
  } else {
    suggestion = `Thank you for contacting ${PRACTICE_NAME}. A team member will respond shortly. For immediate assistance, call ${PRACTICE_PHONE}.`;
  }

  // Save suggestion
  await db.dbRun(
    'UPDATE communication_log SET ai_suggested_response = ? WHERE id = ?',
    [suggestion, communicationId]
  );

  return suggestion;
}

// ==========================================
// HELPERS
// ==========================================

function generateSessionId() {
  return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  // Setup
  initCommunicationsSchema,
  isTwilioConfigured,
  isSendgridConfigured,

  // Messaging
  sendSMS,
  sendEmail,
  sendTemplatedMessage,
  getMessageTemplates,

  // Calls
  logInboundCall,
  triageCall,
  getCallQueue,

  // Video
  createVideoSession,

  // Communication log
  logCommunication,
  getPatientCommunications,
  getRecentCommunications,

  // AI responses
  generateSuggestedResponse
};
