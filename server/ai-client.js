/**
 * MJR-EHR AI Client Module
 * Provides clinical data extraction via pattern matching (mock mode)
 * or Claude API (api mode).
 */

const AI_MODE = process.env.AI_MODE || 'mock';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

function getMode() {
  return ANTHROPIC_API_KEY && AI_MODE === 'api' ? 'api' : 'mock';
}

function isClaudeEnabled() {
  return getMode() === 'api';
}

// ==========================================
// VITALS EXTRACTION
// ==========================================

function extractVitals(transcript) {
  const vitals = {};
  const text = transcript.toLowerCase();

  // Blood pressure: "142 over 88", "142/88", "BP 142/88"
  const bpMatch = transcript.match(/(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})/i);
  if (bpMatch) {
    vitals.systolic_bp = parseInt(bpMatch[1], 10);
    vitals.diastolic_bp = parseInt(bpMatch[2], 10);
  }

  // Heart rate: "heart rate is 76", "pulse 76", "HR 76"
  const hrMatch = transcript.match(/(?:heart\s*rate|pulse|HR)\s*(?:is|of|:)?\s*(\d{2,3})/i);
  if (hrMatch) {
    vitals.heart_rate = parseInt(hrMatch[1], 10);
  }

  // Temperature: "temperature 98.6", "temp 98.6 degrees"
  const tempMatch = transcript.match(/(?:temperature|temp)\s*(?:is|of|:)?\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:degrees|F|fahrenheit)?/i);
  if (tempMatch) {
    vitals.temperature = parseFloat(tempMatch[1]);
  }

  // Weight: "weight is 187", "weighs 187 pounds"
  const weightMatch = transcript.match(/(?:weight|weighs)\s*(?:is|of|:)?\s*(\d{2,4}(?:\.\d{1,2})?)\s*(?:pounds|lbs?|kg)?/i);
  if (weightMatch) {
    vitals.weight = parseFloat(weightMatch[1]);
  }

  // Height: "height is 5 foot 8", "height 68 inches", "5'8"
  const heightFtMatch = transcript.match(/(?:height\s*(?:is|of|:)?\s*)?(\d)\s*(?:foot|feet|ft|')\s*(\d{1,2})\s*(?:inches|in|")?/i);
  if (heightFtMatch) {
    vitals.height = parseInt(heightFtMatch[1], 10) * 12 + parseInt(heightFtMatch[2], 10);
  } else {
    const heightInMatch = transcript.match(/height\s*(?:is|of|:)?\s*(\d{2,3})\s*(?:inches|in)/i);
    if (heightInMatch) {
      vitals.height = parseInt(heightInMatch[1], 10);
    }
  }

  // Respiratory rate: "respiratory rate 16", "RR 16", "breathing rate 16"
  const rrMatch = transcript.match(/(?:respiratory\s*rate|RR|breathing\s*rate)\s*(?:is|of|:)?\s*(\d{1,2})/i);
  if (rrMatch) {
    vitals.respiratory_rate = parseInt(rrMatch[1], 10);
  }

  // SpO2: "oxygen sat 98", "SpO2 98%", "O2 sat 98"
  const spo2Match = transcript.match(/(?:oxygen\s*sat(?:uration)?|SpO2|O2\s*sat)\s*(?:is|of|:)?\s*(\d{2,3})\s*%?/i);
  if (spo2Match) {
    vitals.spo2 = parseInt(spo2Match[1], 10);
  }

  return vitals;
}

// ==========================================
// MEDICATION EXTRACTION
// ==========================================

const FREQUENCY_MAP = {
  'once daily': 'daily',
  'once a day': 'daily',
  'every day': 'daily',
  'daily': 'daily',
  'twice daily': 'BID',
  'twice a day': 'BID',
  'two times a day': 'BID',
  'bid': 'BID',
  'three times daily': 'TID',
  'three times a day': 'TID',
  'tid': 'TID',
  'four times daily': 'QID',
  'four times a day': 'QID',
  'qid': 'QID',
  'at bedtime': 'qHS',
  'at night': 'qHS',
  'qhs': 'qHS',
  'every morning': 'qAM',
  'every night': 'qHS',
  'weekly': 'weekly',
  'once weekly': 'weekly',
  'once a week': 'weekly',
  'every week': 'weekly',
  'every other day': 'QOD',
  'as needed': 'PRN',
  'prn': 'PRN'
};

const ROUTE_MAP = {
  'by mouth': 'PO',
  'orally': 'PO',
  'oral': 'PO',
  'po': 'PO',
  'subcutaneous': 'SC',
  'subcutaneously': 'SC',
  'subq': 'SC',
  'sc': 'SC',
  'intramuscular': 'IM',
  'im': 'IM',
  'intravenous': 'IV',
  'iv': 'IV',
  'topical': 'topical',
  'topically': 'topical',
  'inhaled': 'INH',
  'rectal': 'PR',
  'sublingual': 'SL'
};

function extractMedications(transcript) {
  const medications = [];
  const text = transcript;

  // Pattern: MedicationName dose route frequency
  // e.g., "Metformin 1000mg twice daily", "Ozempic 0.25mg subcutaneously weekly"
  const medPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units?|IU))\b/gi;

  let match;
  while ((match = medPattern.exec(text)) !== null) {
    const name = match[1].trim();
    const dose = match[2].replace(/\s+/g, '');

    // Skip common non-medication words that might match the pattern
    const skipWords = ['patient', 'doctor', 'nurse', 'blood', 'heart', 'stage', 'type', 'about', 'around'];
    if (skipWords.includes(name.toLowerCase())) continue;

    // Find route in surrounding text (within ~60 chars after the dose)
    const afterDose = text.substring(match.index + match[0].length, match.index + match[0].length + 60).toLowerCase();
    let route = 'PO'; // default
    for (const [keyword, routeCode] of Object.entries(ROUTE_MAP)) {
      if (afterDose.includes(keyword)) {
        route = routeCode;
        break;
      }
    }

    // Find frequency in surrounding text (sort by longest keyword first to avoid partial matches)
    const contextAfter = text.substring(match.index, match.index + 120).toLowerCase();
    let frequency = 'daily'; // default
    const sortedFreqs = Object.entries(FREQUENCY_MAP).sort((a, b) => b[0].length - a[0].length);
    for (const [keyword, freqCode] of sortedFreqs) {
      if (contextAfter.includes(keyword)) {
        frequency = freqCode;
        break;
      }
    }

    medications.push({ name, dose, route, frequency });
  }

  return medications;
}

// ==========================================
// PROBLEM/DIAGNOSIS EXTRACTION
// ==========================================

const DIAGNOSIS_MAP = [
  { patterns: [/type\s*2\s*diabetes/i, /diabetes\s*mellitus\s*type\s*2/i, /T2DM/i, /type\s*II\s*diabetes/i], name: 'Type 2 Diabetes Mellitus', code: 'E11.9' },
  { patterns: [/type\s*1\s*diabetes/i, /diabetes\s*mellitus\s*type\s*1/i, /T1DM/i], name: 'Type 1 Diabetes Mellitus', code: 'E10.9' },
  { patterns: [/hypertension/i, /high\s*blood\s*pressure/i, /HTN/i], name: 'Hypertension', code: 'I10' },
  { patterns: [/chronic\s*kidney\s*disease\s*stage\s*3a/i, /CKD\s*(?:stage\s*)?3a/i], name: 'Chronic Kidney Disease Stage 3a', code: 'N18.3' },
  { patterns: [/chronic\s*kidney\s*disease\s*stage\s*3b/i, /CKD\s*(?:stage\s*)?3b/i], name: 'Chronic Kidney Disease Stage 3b', code: 'N18.3' },
  { patterns: [/chronic\s*kidney\s*disease/i, /CKD/i], name: 'Chronic Kidney Disease', code: 'N18.9' },
  { patterns: [/obesity/i, /obese/i, /BMI\s*(?:over|above|>)\s*30/i], name: 'Obesity', code: 'E66.9' },
  { patterns: [/hyperlipidemia/i, /high\s*cholesterol/i], name: 'Hyperlipidemia', code: 'E78.5' },
  { patterns: [/COPD/i, /chronic\s*obstructive\s*pulmonary/i], name: 'COPD', code: 'J44.1' },
  { patterns: [/asthma/i], name: 'Asthma', code: 'J45.909' },
  { patterns: [/heart\s*failure/i, /CHF/i, /congestive\s*heart/i], name: 'Heart Failure', code: 'I50.9' },
  { patterns: [/atrial\s*fibrillation/i, /a\s*fib/i, /afib/i], name: 'Atrial Fibrillation', code: 'I48.91' },
  { patterns: [/coronary\s*artery\s*disease/i, /CAD/i], name: 'Coronary Artery Disease', code: 'I25.10' },
  { patterns: [/depression/i, /major\s*depressive/i, /MDD/i], name: 'Major Depressive Disorder', code: 'F32.9' },
  { patterns: [/anxiety/i, /generalized\s*anxiety/i, /GAD/i], name: 'Generalized Anxiety Disorder', code: 'F41.1' },
  { patterns: [/hypothyroid/i, /low\s*thyroid/i], name: 'Hypothyroidism', code: 'E03.9' },
  { patterns: [/GERD/i, /acid\s*reflux/i, /gastroesophageal\s*reflux/i], name: 'GERD', code: 'K21.0' },
  { patterns: [/osteoarthritis/i, /OA\b/i], name: 'Osteoarthritis', code: 'M19.90' },
  { patterns: [/sleep\s*apnea/i, /OSA/i], name: 'Obstructive Sleep Apnea', code: 'G47.33' },
  { patterns: [/anemia/i], name: 'Anemia', code: 'D64.9' }
];

function extractProblems(transcript) {
  const problems = [];
  const seen = new Set();

  for (const dx of DIAGNOSIS_MAP) {
    for (const pattern of dx.patterns) {
      if (pattern.test(transcript) && !seen.has(dx.code)) {
        seen.add(dx.code);
        problems.push({ name: dx.name, code: dx.code });
        break;
      }
    }
  }

  return problems;
}

// ==========================================
// LAB ORDER EXTRACTION
// ==========================================

const LAB_MAP = [
  { patterns: [/A1C/i, /hemoglobin\s*A1C/i, /HbA1c/i, /glycated\s*hemoglobin/i], name: 'Hemoglobin A1C', cpt: '83036' },
  { patterns: [/basic\s*metabolic\s*panel/i, /BMP/i, /chem\s*7/i], name: 'Basic Metabolic Panel', cpt: '80048' },
  { patterns: [/comprehensive\s*metabolic\s*panel/i, /CMP/i, /chem\s*14/i], name: 'Comprehensive Metabolic Panel', cpt: '80053' },
  { patterns: [/CBC/i, /complete\s*blood\s*count/i], name: 'Complete Blood Count', cpt: '85025' },
  { patterns: [/urine\s*microalbumin/i, /microalbumin/i, /urine\s*albumin/i, /UACR/i], name: 'Urine Microalbumin', cpt: '82043' },
  { patterns: [/lipid\s*panel/i, /lipids/i, /cholesterol\s*panel/i], name: 'Lipid Panel', cpt: '80061' },
  { patterns: [/TSH/i, /thyroid\s*stimulating/i], name: 'TSH', cpt: '84443' },
  { patterns: [/creatinine/i], name: 'Creatinine', cpt: '82565' },
  { patterns: [/eGFR/i, /estimated\s*GFR/i, /glomerular\s*filtration/i], name: 'eGFR', cpt: '82565' },
  { patterns: [/urinalysis/i, /UA\b/i], name: 'Urinalysis', cpt: '81003' },
  { patterns: [/liver\s*function/i, /LFTs?/i, /hepatic\s*panel/i], name: 'Liver Function Tests', cpt: '80076' },
  { patterns: [/PT\s*\/?\s*INR/i, /prothrombin\s*time/i, /INR/i], name: 'PT/INR', cpt: '85610' },
  { patterns: [/vitamin\s*D/i, /25-hydroxy/i], name: 'Vitamin D', cpt: '82306' },
  { patterns: [/ferritin/i], name: 'Ferritin', cpt: '82728' },
  { patterns: [/B12/i, /cobalamin/i], name: 'Vitamin B12', cpt: '82607' },
  { patterns: [/PSA/i, /prostate\s*specific/i], name: 'PSA', cpt: '84153' }
];

function extractLabOrders(transcript) {
  const labs = [];
  const seen = new Set();

  for (const lab of LAB_MAP) {
    for (const pattern of lab.patterns) {
      if (pattern.test(transcript) && !seen.has(lab.cpt)) {
        seen.add(lab.cpt);
        labs.push({ name: lab.name, cpt: lab.cpt });
        break;
      }
    }
  }

  return labs;
}

// ==========================================
// CLINICAL DATA EXTRACTION (COMBINED)
// ==========================================

function extractClinicalData(transcript, patient) {
  return Promise.resolve({
    vitals: extractVitals(transcript),
    medications: extractMedications(transcript),
    problems: extractProblems(transcript),
    labs: extractLabOrders(transcript)
  });
}

// ==========================================
// SOAP NOTE GENERATION
// ==========================================

function generateSOAPNote(transcript, patient, vitals) {
  const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient';
  const age = patient && patient.dob ? calculateAge(patient.dob) : 'Unknown';
  const sex = patient ? patient.sex : '';

  // Extract data from transcript
  const problems = extractProblems(transcript);
  const meds = extractMedications(transcript);
  const labs = extractLabOrders(transcript);

  // Build vitals string
  const vitalsLines = [];
  if (vitals) {
    if (vitals.systolic_bp && vitals.diastolic_bp) vitalsLines.push(`BP: ${vitals.systolic_bp}/${vitals.diastolic_bp} mmHg`);
    if (vitals.heart_rate) vitalsLines.push(`HR: ${vitals.heart_rate} bpm`);
    if (vitals.temperature) vitalsLines.push(`Temp: ${vitals.temperature} F`);
    if (vitals.weight) vitalsLines.push(`Weight: ${vitals.weight} lbs`);
    if (vitals.respiratory_rate) vitalsLines.push(`RR: ${vitals.respiratory_rate}`);
    if (vitals.spo2) vitalsLines.push(`SpO2: ${vitals.spo2}%`);
  }

  // Build problem list for assessment
  const problemLines = problems.map((p, i) => `${i + 1}. ${p.name} (${p.code})`);

  // Build medication plan
  const medLines = meds.map(m => `- ${m.name} ${m.dose} ${m.route} ${m.frequency}`);

  // Build lab orders
  const labLines = labs.map(l => `- ${l.name} (CPT: ${l.cpt})`);

  const note = `SUBJECTIVE:
Patient: ${patientName}, ${age}yo ${sex}
${extractSubjectiveFromTranscript(transcript)}

OBJECTIVE:
Vitals:
${vitalsLines.length > 0 ? vitalsLines.join('\n') : 'Not recorded'}

General: Patient appears well, in no acute distress.

ASSESSMENT:
${problemLines.length > 0 ? problemLines.join('\n') : 'See clinical notes'}

PLAN:
${medLines.length > 0 ? 'Medications:\n' + medLines.join('\n') : ''}
${labLines.length > 0 ? '\nLab Orders:\n' + labLines.join('\n') : ''}
Follow-up as discussed with patient.`;

  return Promise.resolve(note);
}

// Helper to extract subjective content from transcript
function extractSubjectiveFromTranscript(transcript) {
  const lines = transcript.split('\n').filter(l => l.trim());
  const patientStatements = [];
  const chiefComplaints = [];

  for (const line of lines) {
    const patientMatch = line.match(/^(?:Patient|Pt)\s*:\s*(.+)/i);
    if (patientMatch) {
      patientStatements.push(patientMatch[1].trim());
    }
  }

  // Look for chief complaint keywords
  const ccPatterns = [
    /(?:blood\s*sugars?\s*(?:have\s*been|are|running)\s*(?:high|low|elevated))/i,
    /(?:pain\s*in|hurts?\s*(?:my)?)\s+(\w+)/i,
    /(?:not\s*(?:feeling|doing)\s*(?:well|great|good))/i,
    /(?:having\s*(?:trouble|problems?|difficulty))\s+(?:with\s+)?(\w+)/i,
    /(?:shortness\s*of\s*breath|SOB)/i,
    /(?:chest\s*pain)/i,
    /(?:headache|cough|fever|fatigue|dizzy|dizziness)/i
  ];

  for (const pattern of ccPatterns) {
    const match = transcript.match(pattern);
    if (match) {
      chiefComplaints.push(match[0]);
    }
  }

  const parts = [];
  if (chiefComplaints.length > 0) {
    parts.push(`Chief Complaint: ${chiefComplaints[0]}`);
  }
  if (patientStatements.length > 0) {
    parts.push(`HPI: ${patientStatements.slice(0, 3).join(' ')}`);
  }

  return parts.length > 0 ? parts.join('\n') : 'See transcript for details.';
}

// Helper - calculateAge (duplicated from database.js for independence)
function calculateAge(dob) {
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

module.exports = {
  getMode,
  isClaudeEnabled,
  extractVitals,
  extractMedications,
  extractProblems,
  extractLabOrders,
  extractClinicalData,
  generateSOAPNote
};
