/**
 * MJR-EHR Voice Pipeline
 *
 * Server-side voice processing pipeline that integrates with:
 * - Deepgram (primary ASR provider)
 * - OpenAI Whisper (alternative ASR)
 * - Browser Web Speech API (fallback, client-side)
 *
 * Features:
 * - Streaming transcript processing with real-time entity extraction
 * - Voice command recognition for hands-free operation
 * - Speaker diarization (provider vs patient)
 * - Medical terminology boost / custom vocabulary
 * - Audio recording management
 * - Integration with existing ai-client extraction pipeline
 */

const aiClient = require('./ai-client');

// ==========================================
// CONFIGURATION
// ==========================================

const ASR_PROVIDER = process.env.ASR_PROVIDER || 'browser'; // 'deepgram', 'whisper', 'browser'
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const MEDICAL_VOCABULARY = [
  'metformin', 'lisinopril', 'amlodipine', 'atorvastatin', 'empagliflozin',
  'semaglutide', 'ozempic', 'jardiance', 'eliquis', 'apixaban',
  'hemoglobin', 'creatinine', 'eGFR', 'microalbumin', 'troponin',
  'A1C', 'HbA1c', 'BNP', 'proBNP', 'TSH',
  'hypertension', 'diabetes mellitus', 'hyperlipidemia', 'COPD',
  'atrial fibrillation', 'congestive heart failure', 'chronic kidney disease',
  'dyspnea', 'tachycardia', 'bradycardia', 'orthopnea',
  'paroxysmal nocturnal dyspnea', 'peripheral neuropathy',
  'systolic', 'diastolic', 'SpO2', 'respiratory rate',
  'bilateral', 'subcutaneous', 'intramuscular', 'sublingual',
  'twice daily', 'three times daily', 'at bedtime', 'as needed',
  'auscultation', 'palpation', 'percussion'
];

// ==========================================
// VOICE COMMAND SYSTEM
// ==========================================

const VOICE_COMMANDS = [
  // Navigation commands
  { patterns: [/^(?:go to|open|show|navigate to)\s+dashboard/i], action: 'navigate', target: '/' },
  { patterns: [/^(?:go to|open|show)\s+patient\s+(\w+)/i], action: 'navigate_patient', target: '/patient/' },
  { patterns: [/^(?:next|advance|move to next)\s+(?:step|stage|phase)/i], action: 'workflow_advance' },

  // Recording commands
  { patterns: [/^(?:start|begin)\s+(?:recording|listening|dictation)/i], action: 'start_recording' },
  { patterns: [/^(?:stop|end|pause)\s+(?:recording|listening|dictation)/i], action: 'stop_recording' },
  { patterns: [/^(?:clear|reset)\s+(?:transcript|recording)/i], action: 'clear_transcript' },

  // Clinical commands
  { patterns: [/^(?:order|get)\s+(?:labs?|bloodwork)\s+(.+)/i], action: 'order_labs', extractGroup: 1 },
  { patterns: [/^(?:prescribe|start|order)\s+(.+?\s+\d+\s*(?:mg|mcg|g|ml|units?))/i], action: 'prescribe', extractGroup: 1 },
  { patterns: [/^(?:refer|referral)\s+(?:to\s+)?(.+)/i], action: 'refer', extractGroup: 1 },
  { patterns: [/^(?:order|get)\s+(?:imaging|scan|x-?ray|CT|MRI|echo)\s*(.+)?/i], action: 'order_imaging', extractGroup: 1 },

  // Note commands
  { patterns: [/^(?:generate|create|write)\s+(?:SOAP\s+)?note/i], action: 'generate_note' },
  { patterns: [/^(?:sign|finalize|complete)\s+(?:the\s+)?(?:note|encounter|chart)/i], action: 'sign_note' },
  { patterns: [/^(?:add|note|document)\s+(?:to\s+)?(?:assessment|plan)\s*[:\s]+(.+)/i], action: 'add_to_plan', extractGroup: 1 },

  // CDS commands
  { patterns: [/^(?:show|what are|list)\s+(?:the\s+)?(?:suggestions|alerts|recommendations)/i], action: 'show_suggestions' },
  { patterns: [/^accept\s+(?:suggestion|recommendation)\s+(\d+)/i], action: 'accept_suggestion', extractGroup: 1 },
  { patterns: [/^(?:dismiss|reject|skip)\s+(?:suggestion|recommendation)\s+(\d+)/i], action: 'reject_suggestion', extractGroup: 1 },

  // Quick documentation
  { patterns: [/^(?:vitals?)\s+(?:are\s+)?(.+)/i], action: 'record_vitals', extractGroup: 1 },
  { patterns: [/^(?:chief complaint|CC)\s+(?:is\s+)?(.+)/i], action: 'set_chief_complaint', extractGroup: 1 },
];

/**
 * Parse voice input for commands.
 * Returns command object if matched, null otherwise.
 */
function parseVoiceCommand(text) {
  const trimmed = text.trim();

  for (const cmd of VOICE_COMMANDS) {
    for (const pattern of cmd.patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        return {
          action: cmd.action,
          target: cmd.target || null,
          parameter: cmd.extractGroup ? match[cmd.extractGroup]?.trim() : null,
          raw: trimmed,
          confidence: 1.0
        };
      }
    }
  }

  return null;
}

// ==========================================
// STREAMING TRANSCRIPT PROCESSOR
// ==========================================

/**
 * Manages a streaming transcript session.
 * Processes audio chunks and maintains running context.
 */
class TranscriptSession {
  constructor(encounterId, patientId, options = {}) {
    this.encounterId = encounterId;
    this.patientId = patientId;
    this.segments = [];
    this.fullTranscript = '';
    this.extractedData = {
      vitals: {},
      medications: [],
      problems: [],
      labs: [],
      imaging: [],
      ros: {},
      physical_exam: {}
    };
    this.pendingCommands = [];
    this.speakers = new Map(); // speaker ID -> label
    this.startTime = Date.now();
    this.lastUpdateTime = Date.now();
    this.onUpdate = options.onUpdate || null;
    this.onCommand = options.onCommand || null;
    this.autoExtract = options.autoExtract !== false;
    this.extractionInterval = options.extractionInterval || 5000; // ms between extractions
    this.lastExtractionTime = 0;
  }

  /**
   * Add a new transcript segment (from ASR).
   */
  addSegment(text, metadata = {}) {
    const segment = {
      id: this.segments.length,
      text: text.trim(),
      timestamp: Date.now(),
      speaker: metadata.speaker || 'unknown',
      confidence: metadata.confidence || 1.0,
      isFinal: metadata.isFinal !== false,
      channel: metadata.channel || 0
    };

    this.segments.push(segment);
    this.lastUpdateTime = Date.now();

    // Update full transcript
    if (segment.isFinal) {
      this.fullTranscript += (this.fullTranscript ? ' ' : '') + segment.text;
    }

    // Check for voice commands
    const command = parseVoiceCommand(segment.text);
    if (command) {
      this.pendingCommands.push({ ...command, segmentId: segment.id, timestamp: segment.timestamp });
      if (this.onCommand) this.onCommand(command);
    }

    // Auto-extract clinical data periodically
    if (this.autoExtract && segment.isFinal &&
        (Date.now() - this.lastExtractionTime > this.extractionInterval)) {
      this.extractClinicalData();
    }

    if (this.onUpdate) {
      this.onUpdate({
        type: 'segment',
        segment,
        command,
        transcript: this.fullTranscript
      });
    }

    return segment;
  }

  /**
   * Run clinical data extraction on current transcript.
   */
  extractClinicalData() {
    if (!this.fullTranscript) return this.extractedData;

    this.lastExtractionTime = Date.now();

    // Use existing extraction pipeline
    const vitals = aiClient.extractVitals(this.fullTranscript);
    const medications = aiClient.extractMedications(this.fullTranscript);
    const problems = aiClient.extractProblems(this.fullTranscript);
    const labs = aiClient.extractLabOrders(this.fullTranscript);
    const imaging = aiClient.extractImagingOrders(this.fullTranscript);
    const ros = aiClient.extractROS(this.fullTranscript);
    const pe = aiClient.extractPhysicalExam(this.fullTranscript);

    // Merge with existing extractions (don't lose previously extracted data)
    if (Object.keys(vitals).length > 0) {
      Object.assign(this.extractedData.vitals, vitals);
    }

    // Merge arrays without duplicates
    this.extractedData.medications = mergeByField(this.extractedData.medications, medications, 'name');
    this.extractedData.problems = mergeByField(this.extractedData.problems, problems, 'code');
    this.extractedData.labs = mergeByField(this.extractedData.labs, labs, 'cpt');
    this.extractedData.imaging = mergeByField(this.extractedData.imaging, imaging, i => `${i.study_type}-${i.body_part}`);

    if (Object.keys(ros).length > 0) {
      Object.assign(this.extractedData.ros, ros);
    }
    if (Object.keys(pe).length > 0) {
      Object.assign(this.extractedData.physical_exam, pe);
    }

    if (this.onUpdate) {
      this.onUpdate({
        type: 'extraction',
        extractedData: this.extractedData,
        transcript: this.fullTranscript
      });
    }

    return this.extractedData;
  }

  /**
   * Label a speaker (e.g., from diarization).
   */
  labelSpeaker(speakerId, label) {
    this.speakers.set(speakerId, label);
  }

  /**
   * Get transcript formatted by speaker.
   */
  getFormattedTranscript() {
    return this.segments
      .filter(s => s.isFinal)
      .map(s => {
        const speaker = this.speakers.get(s.speaker) || s.speaker;
        return `${speaker}: ${s.text}`;
      })
      .join('\n');
  }

  /**
   * Get session summary.
   */
  getSummary() {
    return {
      encounterId: this.encounterId,
      patientId: this.patientId,
      duration: Date.now() - this.startTime,
      segmentCount: this.segments.length,
      wordCount: this.fullTranscript.split(/\s+/).filter(Boolean).length,
      speakers: Object.fromEntries(this.speakers),
      extractedData: this.extractedData,
      pendingCommands: this.pendingCommands,
      transcript: this.fullTranscript,
      formattedTranscript: this.getFormattedTranscript()
    };
  }

  /**
   * Flush pending commands.
   */
  flushCommands() {
    const cmds = [...this.pendingCommands];
    this.pendingCommands = [];
    return cmds;
  }
}

// ==========================================
// ASR PROVIDER ABSTRACTION
// ==========================================

/**
 * Create ASR configuration for the configured provider.
 * Returns config that can be used client-side or server-side.
 */
function getASRConfig() {
  switch (ASR_PROVIDER) {
    case 'deepgram':
      return {
        provider: 'deepgram',
        available: !!DEEPGRAM_API_KEY,
        config: {
          model: 'nova-2-medical',
          language: 'en-US',
          smart_format: true,
          punctuate: true,
          diarize: true,
          utterances: true,
          keywords: MEDICAL_VOCABULARY.map(w => `${w}:2`), // boost weight
          filler_words: false,
          interim_results: true,
          endpointing: 300 // ms of silence before final result
        },
        // WebSocket URL template (client connects directly for streaming)
        wsUrl: 'wss://api.deepgram.com/v1/listen',
        // REST URL for file upload
        restUrl: 'https://api.deepgram.com/v1/listen'
      };

    case 'whisper':
      return {
        provider: 'whisper',
        available: !!OPENAI_API_KEY,
        config: {
          model: 'whisper-1',
          language: 'en',
          response_format: 'verbose_json',
          temperature: 0,
          prompt: `Medical encounter transcription. Common terms: ${MEDICAL_VOCABULARY.slice(0, 20).join(', ')}`
        },
        restUrl: 'https://api.openai.com/v1/audio/transcriptions'
      };

    case 'browser':
    default:
      return {
        provider: 'browser',
        available: true,
        config: {
          lang: 'en-US',
          continuous: true,
          interimResults: true,
          maxAlternatives: 1
        },
        // No server-side URLs needed — all client-side
        wsUrl: null,
        restUrl: null
      };
  }
}

/**
 * Transcribe an audio buffer using the configured ASR provider.
 * For non-streaming (batch) transcription.
 */
async function transcribeAudio(audioBuffer, options = {}) {
  const config = getASRConfig();

  if (!config.available) {
    throw new Error(`ASR provider '${config.provider}' is not configured. Check API keys.`);
  }

  switch (config.provider) {
    case 'deepgram':
      return transcribeWithDeepgram(audioBuffer, options);
    case 'whisper':
      return transcribeWithWhisper(audioBuffer, options);
    case 'browser':
      throw new Error('Browser ASR does not support server-side transcription. Use client-side Web Speech API.');
    default:
      throw new Error(`Unknown ASR provider: ${config.provider}`);
  }
}

async function transcribeWithDeepgram(audioBuffer, options = {}) {
  const config = getASRConfig();
  const params = new URLSearchParams({
    model: 'nova-2-medical',
    language: 'en-US',
    smart_format: 'true',
    punctuate: 'true',
    diarize: options.diarize !== false ? 'true' : 'false',
    utterances: 'true'
  });

  const response = await fetch(`${config.restUrl}?${params}`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${DEEPGRAM_API_KEY}`,
      'Content-Type': options.contentType || 'audio/wav'
    },
    body: audioBuffer
  });

  if (!response.ok) {
    throw new Error(`Deepgram API error: ${response.status}`);
  }

  const data = await response.json();
  const result = data.results?.channels?.[0]?.alternatives?.[0];

  return {
    provider: 'deepgram',
    transcript: result?.transcript || '',
    confidence: result?.confidence || 0,
    words: result?.words || [],
    utterances: data.results?.utterances || [],
    speakers: extractSpeakers(data.results?.utterances || []),
    duration: data.metadata?.duration || 0
  };
}

async function transcribeWithWhisper(audioBuffer, options = {}) {
  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: options.contentType || 'audio/wav' }), 'audio.wav');
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');
  formData.append('response_format', 'verbose_json');
  formData.append('temperature', '0');
  formData.append('prompt', `Medical encounter: ${MEDICAL_VOCABULARY.slice(0, 15).join(', ')}`);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Whisper API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    provider: 'whisper',
    transcript: data.text || '',
    confidence: 1.0, // Whisper doesn't provide confidence scores
    words: data.words || [],
    segments: data.segments || [],
    duration: data.duration || 0
  };
}

function extractSpeakers(utterances) {
  const speakers = new Map();
  for (const u of utterances) {
    const id = u.speaker?.toString() || '0';
    if (!speakers.has(id)) {
      speakers.set(id, { id, segments: 0, words: 0 });
    }
    const s = speakers.get(id);
    s.segments++;
    s.words += (u.transcript || '').split(/\s+/).length;
  }
  return Object.fromEntries(speakers);
}

// ==========================================
// REAL-TIME EXTRACTION PIPELINE
// ==========================================

/**
 * Process a transcript chunk in real-time.
 * Extracts clinical entities incrementally.
 */
function processTranscriptChunk(chunk, existingExtractions = {}) {
  const newExtractions = {
    vitals: aiClient.extractVitals(chunk),
    medications: aiClient.extractMedications(chunk),
    problems: aiClient.extractProblems(chunk),
    labs: aiClient.extractLabOrders(chunk),
    imaging: aiClient.extractImagingOrders(chunk),
    ros: aiClient.extractROS(chunk),
    physical_exam: aiClient.extractPhysicalExam(chunk)
  };

  // Check for voice commands
  const command = parseVoiceCommand(chunk);

  // Calculate what's new vs what we already had
  const delta = {
    newVitals: Object.keys(newExtractions.vitals).filter(k => !existingExtractions.vitals?.[k]),
    newMedications: newExtractions.medications.filter(m => !existingExtractions.medications?.some(em => em.name === m.name)),
    newProblems: newExtractions.problems.filter(p => !existingExtractions.problems?.some(ep => ep.code === p.code)),
    newLabs: newExtractions.labs.filter(l => !existingExtractions.labs?.some(el => el.cpt === l.cpt)),
    newImaging: newExtractions.imaging.filter(i => !existingExtractions.imaging?.some(ei => ei.study_type === i.study_type && ei.body_part === i.body_part))
  };

  return {
    extractions: newExtractions,
    delta,
    hasNewData: Object.values(delta).some(arr => arr.length > 0),
    command
  };
}

// ==========================================
// SESSION MANAGEMENT
// ==========================================

const activeSessions = new Map();

function createSession(encounterId, patientId, options = {}) {
  const session = new TranscriptSession(encounterId, patientId, options);
  activeSessions.set(encounterId, session);
  return session;
}

function getSession(encounterId) {
  return activeSessions.get(encounterId) || null;
}

function endSession(encounterId) {
  const session = activeSessions.get(encounterId);
  if (session) {
    const summary = session.getSummary();
    activeSessions.delete(encounterId);
    return summary;
  }
  return null;
}

function getActiveSessions() {
  const sessions = [];
  for (const [id, session] of activeSessions) {
    sessions.push({
      encounterId: id,
      patientId: session.patientId,
      duration: Date.now() - session.startTime,
      segmentCount: session.segments.length,
      wordCount: session.fullTranscript.split(/\s+/).filter(Boolean).length
    });
  }
  return sessions;
}

// ==========================================
// HELPERS
// ==========================================

function mergeByField(existing, incoming, keyField) {
  const keyFn = typeof keyField === 'function' ? keyField : (item) => item[keyField];
  const keys = new Set(existing.map(keyFn));
  const merged = [...existing];
  for (const item of incoming) {
    if (!keys.has(keyFn(item))) {
      merged.push(item);
      keys.add(keyFn(item));
    }
  }
  return merged;
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  // Configuration
  getASRConfig,
  MEDICAL_VOCABULARY,

  // Transcription
  transcribeAudio,

  // Voice commands
  parseVoiceCommand,
  VOICE_COMMANDS,

  // Streaming pipeline
  TranscriptSession,
  processTranscriptChunk,

  // Session management
  createSession,
  getSession,
  endSession,
  getActiveSessions
};
