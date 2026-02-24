/**
 * MJR-EHR LLM-Augmented Clinical Decision Support
 *
 * Enhances the existing rule-based CDS engine with LLM reasoning:
 * - Chain-of-thought clinical explanations
 * - Complex multi-factor reasoning beyond simple rule thresholds
 * - Differential diagnosis reasoning with confidence scoring
 * - Treatment pathway simulation
 * - Guideline-aware recommendation generation
 *
 * Falls back to rule engine when LLM is unavailable.
 */

const AI_MODE = process.env.AI_MODE || 'mock';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const LLM_CDS_ENABLED = process.env.LLM_CDS_ENABLED !== 'false';

// ==========================================
// LLM CLIENT ABSTRACTION
// ==========================================

/**
 * Call the LLM with a clinical reasoning prompt.
 * Returns structured JSON output.
 */
async function callLLM(systemPrompt, userPrompt, options = {}) {
  if (!ANTHROPIC_API_KEY || AI_MODE !== 'api') {
    return null; // fallback to mock reasoning
  }

  const maxTokens = options.maxTokens || 2048;
  const temperature = options.temperature || 0.2; // low temperature for clinical reasoning

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: options.model || 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      console.error('LLM CDS API error:', response.status);
      return null;
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Try to parse as JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { reasoning: text };
  } catch (err) {
    console.error('LLM CDS call failed:', err.message);
    return null;
  }
}

// ==========================================
// CLINICAL REASONING SYSTEM PROMPTS
// ==========================================

const CLINICAL_REASONING_SYSTEM = `You are a clinical decision support AI assistant integrated into an EHR system.
Your role is to provide evidence-based clinical reasoning to assist providers.

CRITICAL RULES:
1. NEVER provide a definitive diagnosis — always frame as "consider" or "evaluate for"
2. ALWAYS cite clinical guidelines (ADA, AHA, KDIGO, ACC, IDSA, etc.)
3. ALWAYS recommend human provider review for any clinical action
4. Flag safety-critical findings with URGENT priority
5. Consider drug-drug interactions, drug-allergy contraindications, and renal dosing
6. Respond in structured JSON format

You have access to the patient's full clinical context including:
- Demographics, problem list, medications, allergies
- Recent vitals, lab results, imaging
- Current encounter transcript and chief complaint
- Provider's historical practice patterns`;

const DIFFERENTIAL_SYSTEM = `You are a clinical reasoning engine for differential diagnosis.
Given a patient's presentation, generate a ranked differential diagnosis list.

For each differential:
1. Provide the condition name and ICD-10 code
2. Estimate likelihood (high/moderate/low) based on the clinical context
3. List specific workup steps to confirm or rule out
4. Note any red flags that increase urgency

Respond in JSON format:
{
  "differentials": [
    {
      "condition": "name",
      "icd10": "code",
      "likelihood": "high|moderate|low",
      "reasoning": "why this is on the differential",
      "workup": ["step1", "step2"],
      "red_flags": ["flag1"]
    }
  ],
  "most_likely": "condition name",
  "urgent_considerations": ["list of things that need immediate attention"],
  "reasoning_chain": "step-by-step reasoning explanation"
}`;

const TREATMENT_REASONING_SYSTEM = `You are a treatment recommendation engine.
Given a patient's diagnosis and clinical context, reason through treatment options.

Consider:
1. Current medications and potential interactions
2. Renal function (eGFR) for dose adjustments
3. Allergies and contraindications
4. Evidence-based guidelines (cite specific guidelines)
5. Patient's existing conditions that affect treatment choice
6. Cost-effectiveness when multiple options exist

Respond in JSON format:
{
  "recommended_actions": [
    {
      "type": "medication|lab_order|imaging|referral|lifestyle",
      "action": "description",
      "rationale": "evidence-based reasoning",
      "guideline": "specific guideline citation",
      "priority": "urgent|routine",
      "alternatives": ["alt1", "alt2"],
      "contraindication_check": "passed|warning|blocked",
      "contraindication_detail": "if warning or blocked, explain why"
    }
  ],
  "reasoning_chain": "step-by-step treatment reasoning",
  "monitoring_plan": ["what to monitor and when"]
}`;

// ==========================================
// MOCK REASONING ENGINE (No API Key)
// ==========================================

/**
 * Pattern-based clinical reasoning when LLM is unavailable.
 * Provides structured but simpler reasoning than the LLM.
 */
function mockClinicalReasoning(context) {
  const reasoning = {
    chain_of_thought: [],
    suggestions: [],
    risk_factors: []
  };

  const { patient, problems, medications, allergies, vitals, labs } = context;

  // Analyze vital trends
  if (vitals) {
    if (vitals.systolic_bp >= 180 || vitals.diastolic_bp >= 120) {
      reasoning.chain_of_thought.push(
        'Patient presents with severely elevated blood pressure (hypertensive crisis territory).',
        'Immediate BP recheck needed. Assess for end-organ damage symptoms.',
        'Consider IV antihypertensive if confirmed on recheck.'
      );
      reasoning.suggestions.push({
        type: 'vital_alert',
        title: 'Hypertensive Crisis — Immediate Action Required',
        description: `BP ${vitals.systolic_bp}/${vitals.diastolic_bp} is in crisis range. Recheck in 5 minutes. Assess for headache, visual changes, chest pain, dyspnea.`,
        priority: 1,
        reasoning: reasoning.chain_of_thought.join(' '),
        guideline: 'AHA/ACC 2017 Hypertension Guidelines',
        actions: [
          { type: 'vital_recheck', description: 'Recheck BP in 5 minutes' },
          { type: 'assessment', description: 'Assess for end-organ damage' }
        ]
      });
    } else if (vitals.systolic_bp >= 140 || vitals.diastolic_bp >= 90) {
      const onAntihypertensive = medications?.some(m =>
        /lisinopril|amlodipine|losartan|metoprolol|hydrochlorothiazide/i.test(m.medication_name)
      );

      reasoning.chain_of_thought.push(
        `BP ${vitals.systolic_bp}/${vitals.diastolic_bp} exceeds Stage 2 threshold.`,
        onAntihypertensive
          ? 'Patient is already on antihypertensive therapy — consider dose increase or add second agent.'
          : 'Patient is not on antihypertensive therapy — initiate treatment per guidelines.'
      );

      reasoning.suggestions.push({
        type: 'medication_adjustment',
        title: onAntihypertensive ? 'Optimize Antihypertensive Therapy' : 'Initiate Antihypertensive Therapy',
        description: reasoning.chain_of_thought.join(' '),
        priority: 15,
        guideline: 'AHA/ACC 2017 Hypertension Guidelines',
        actions: onAntihypertensive
          ? [{ type: 'medication_adjustment', description: 'Consider titrating current antihypertensive or adding second agent' }]
          : [{ type: 'create_prescription', description: 'Start Lisinopril 10mg PO daily or Amlodipine 5mg PO daily' }]
      });
    }

    if (vitals.heart_rate > 100) {
      reasoning.risk_factors.push('Tachycardia may indicate dehydration, anxiety, thyroid dysfunction, cardiac arrhythmia, or infection');
    }

    if (vitals.spo2 && vitals.spo2 < 92) {
      reasoning.risk_factors.push('Hypoxia requires immediate supplemental O2 and workup for pulmonary/cardiac causes');
    }
  }

  // Analyze diabetes management
  const hasDiabetes = problems?.some(p => p.icd10_code?.startsWith('E11'));
  if (hasDiabetes) {
    const a1c = labs?.find(l => l.test_name === 'Hemoglobin A1C');
    const egfr = labs?.find(l => l.test_name === 'eGFR');
    const uacr = labs?.find(l => l.test_name === 'Urine Microalbumin');

    if (a1c) {
      const a1cVal = parseFloat(a1c.result_value);
      if (a1cVal >= 9.0) {
        reasoning.chain_of_thought.push(
          `A1C is ${a1cVal}% — significantly above target of <7%.`,
          'Consider dual or triple therapy. Evaluate for insulin initiation.',
          'Check medication adherence. Consider endocrinology referral.'
        );
        reasoning.suggestions.push({
          type: 'treatment_escalation',
          title: 'Significantly Elevated A1C — Consider Therapy Escalation',
          description: `A1C ${a1cVal}% requires aggressive management. ADA recommends early combination therapy when A1C >9%.`,
          priority: 10,
          guideline: 'ADA Standards of Care 2024',
          actions: [
            { type: 'create_prescription', description: 'Add GLP-1 agonist (Semaglutide) or SGLT2i if not contraindicated' },
            { type: 'create_referral', description: 'Endocrinology referral for insulin management' }
          ]
        });
      } else if (a1cVal >= 7.0) {
        const onMetformin = medications?.some(m => /metformin/i.test(m.medication_name));
        const onSGLT2 = medications?.some(m => /empagliflozin|dapagliflozin|canagliflozin|jardiance|farxiga/i.test(m.medication_name));
        const onGLP1 = medications?.some(m => /semaglutide|liraglutide|dulaglutide|ozempic|trulicity/i.test(m.medication_name));

        reasoning.chain_of_thought.push(
          `A1C is ${a1cVal}% — above target of <7%.`,
          `Current diabetes medications: ${onMetformin ? 'Metformin' : ''}${onSGLT2 ? ', SGLT2i' : ''}${onGLP1 ? ', GLP-1 RA' : ''}.`
        );

        // Check if SGLT2i is appropriate (also beneficial for CKD/CHF)
        const hasCKD = problems?.some(p => p.icd10_code?.startsWith('N18'));
        const hasCHF = problems?.some(p => p.icd10_code?.startsWith('I50'));

        if (!onSGLT2 && (hasCKD || hasCHF)) {
          reasoning.chain_of_thought.push(
            'Patient has CKD and/or CHF — SGLT2 inhibitor has both glycemic and cardiorenal benefit.'
          );
          reasoning.suggestions.push({
            type: 'medication',
            title: 'Consider SGLT2 Inhibitor — Cardiorenal Benefit',
            description: `Patient with DM2 + ${hasCKD ? 'CKD' : ''}${hasCKD && hasCHF ? ' + ' : ''}${hasCHF ? 'CHF' : ''}: SGLT2i provides glycemic control plus cardiorenal protection.`,
            priority: 20,
            guideline: 'ADA Standards of Care 2024, KDIGO 2024',
            actions: [
              { type: 'create_prescription', description: 'Empagliflozin 10mg PO daily or Dapagliflozin 10mg PO daily', payload: { medication_name: 'Empagliflozin', dose: '10mg', route: 'PO', frequency: 'daily' } }
            ]
          });
        }

        // Check renal dosing for metformin
        if (onMetformin && egfr) {
          const egfrVal = parseFloat(egfr.result_value);
          if (egfrVal < 30) {
            reasoning.suggestions.push({
              type: 'medication_adjustment',
              title: 'CONTRAINDICATION: Metformin with eGFR < 30',
              description: `eGFR is ${egfrVal} — Metformin is contraindicated below 30 mL/min. Discontinue immediately.`,
              priority: 3,
              guideline: 'FDA Metformin Label, ADA Standards of Care',
              actions: [
                { type: 'discontinue_medication', description: 'Discontinue Metformin — eGFR below safe threshold' }
              ]
            });
          } else if (egfrVal < 45) {
            reasoning.suggestions.push({
              type: 'dose_adjustment',
              title: 'Metformin Dose Reduction — eGFR 30-45',
              description: `eGFR is ${egfrVal} — Reduce Metformin to max 500mg BID per FDA guidance.`,
              priority: 10,
              guideline: 'FDA Metformin Label',
              actions: [
                { type: 'medication_adjustment', description: 'Reduce Metformin to 500mg BID' }
              ]
            });
          }
        }
      }
    }

    // UACR monitoring
    if (uacr) {
      const uacrVal = parseFloat(uacr.result_value);
      if (uacrVal > 300) {
        reasoning.suggestions.push({
          type: 'treatment_escalation',
          title: 'Severely Elevated UACR — Nephrotic-Range Albuminuria',
          description: `UACR ${uacrVal} mg/g (>300 = severely increased). Maximize RAAS blockade. Consider finerenone if available.`,
          priority: 10,
          guideline: 'KDIGO 2024 CKD Guidelines',
          actions: [
            { type: 'medication_adjustment', description: 'Maximize ACE/ARB dose' },
            { type: 'create_referral', description: 'Nephrology referral', payload: { specialty: 'Nephrology', reason: 'Severely elevated UACR', urgency: 'routine' } }
          ]
        });
      } else if (uacrVal > 30) {
        const onACEARB = medications?.some(m => /lisinopril|enalapril|ramipril|losartan|valsartan|irbesartan/i.test(m.medication_name));
        if (!onACEARB) {
          reasoning.suggestions.push({
            type: 'medication',
            title: 'Start ACE/ARB — Albuminuria Without RAAS Blockade',
            description: `UACR ${uacrVal} mg/g with no ACE/ARB on med list. RAAS blockade slows CKD progression.`,
            priority: 15,
            guideline: 'KDIGO 2024, ADA Standards of Care',
            actions: [
              { type: 'create_prescription', description: 'Lisinopril 10mg PO daily', payload: { medication_name: 'Lisinopril', dose: '10mg', route: 'PO', frequency: 'daily' } }
            ]
          });
        }
      }
    }
  }

  // CHF-specific reasoning
  const hasCHF = problems?.some(p => p.icd10_code?.startsWith('I50'));
  if (hasCHF && labs) {
    const bnp = labs.find(l => /BNP/i.test(l.test_name));
    if (bnp) {
      const bnpVal = parseFloat(bnp.result_value);
      if (bnpVal > 400) {
        reasoning.suggestions.push({
          type: 'treatment_escalation',
          title: 'Elevated BNP — Assess for CHF Decompensation',
          description: `BNP ${bnpVal} pg/mL significantly elevated. Assess volume status, consider diuretic adjustment.`,
          priority: 10,
          guideline: 'ACC/AHA Heart Failure Guidelines 2022',
          actions: [
            { type: 'assessment', description: 'Assess volume status — JVD, edema, lung crackles' },
            { type: 'medication_adjustment', description: 'Consider increasing Furosemide or adding Metolazone' },
            { type: 'create_imaging_order', description: 'Echocardiogram if not done recently' }
          ]
        });
      }
    }
  }

  // Drug-allergy analysis
  if (allergies && medications) {
    for (const allergy of allergies) {
      const allergen = allergy.allergen?.toLowerCase();
      if (allergen === 'penicillin') {
        const hasPenicillinClass = medications.some(m =>
          /amoxicillin|augmentin|ampicillin|penicillin|piperacillin/i.test(m.medication_name)
        );
        if (hasPenicillinClass) {
          reasoning.suggestions.push({
            type: 'allergy_alert',
            title: 'CRITICAL: Penicillin-Class Drug with Known Allergy',
            description: 'Patient has documented Penicillin allergy and is currently prescribed a penicillin-class drug. REVIEW IMMEDIATELY.',
            priority: 1,
            guideline: 'AAAAI Drug Allergy Practice Parameter',
            actions: [{ type: 'review_medication', description: 'Review and change to alternative antibiotic' }]
          });
        }
      }
    }
  }

  return reasoning;
}

// ==========================================
// LLM-AUGMENTED REASONING
// ==========================================

/**
 * Generate LLM-augmented differential diagnosis.
 * Falls back to mock reasoning if LLM unavailable.
 */
async function generateDifferentialDiagnosis(context) {
  const { patient, problems, medications, allergies, vitals, labs, transcript, chiefComplaint } = context;

  const patientSummary = buildPatientSummary(context);

  const prompt = `Generate a differential diagnosis for this patient:

${patientSummary}

Chief Complaint: ${chiefComplaint || 'See transcript'}
${transcript ? `\nEncounter Transcript:\n${transcript.substring(0, 3000)}` : ''}

Provide a ranked differential with reasoning, workup plan, and red flags.`;

  const llmResult = await callLLM(DIFFERENTIAL_SYSTEM, prompt, { maxTokens: 2048 });

  if (llmResult && llmResult.differentials) {
    return {
      source: 'llm',
      ...llmResult,
      disclaimer: 'AI-generated differential. Provider review required before clinical action.'
    };
  }

  // Fallback: generate basic differential from transcript keywords
  return generateMockDifferential(context);
}

/**
 * Generate LLM-augmented treatment recommendations.
 */
async function generateTreatmentPlan(context, diagnosis) {
  const patientSummary = buildPatientSummary(context);

  const prompt = `Generate treatment recommendations for this patient:

${patientSummary}

Working Diagnosis: ${diagnosis}

Consider all current medications, allergies, and renal function when recommending treatments.
Flag any contraindications or required dose adjustments.`;

  const llmResult = await callLLM(TREATMENT_REASONING_SYSTEM, prompt, { maxTokens: 2048 });

  if (llmResult && llmResult.recommended_actions) {
    return {
      source: 'llm',
      ...llmResult,
      disclaimer: 'AI-generated treatment plan. Provider approval required before any orders.'
    };
  }

  // Fallback
  return {
    source: 'mock',
    recommended_actions: [],
    reasoning_chain: 'LLM unavailable. Use rule-based CDS suggestions.',
    disclaimer: 'LLM reasoning unavailable. Showing rule-based suggestions only.'
  };
}

/**
 * Full clinical reasoning pass — combines rule engine + LLM.
 * This is the main entry point.
 */
async function augmentedClinicalReasoning(context, existingRuleSuggestions = []) {
  if (!LLM_CDS_ENABLED) {
    return {
      source: 'rules_only',
      suggestions: existingRuleSuggestions,
      reasoning: null
    };
  }

  // Always run mock reasoning (it's fast and catches important patterns)
  const mockResult = mockClinicalReasoning(context);

  // Try LLM augmentation
  const patientSummary = buildPatientSummary(context);
  const llmResult = await callLLM(CLINICAL_REASONING_SYSTEM, `Analyze this patient's clinical context and provide reasoning:

${patientSummary}

Existing CDS alerts (from rule engine):
${existingRuleSuggestions.map(s => `- [${s.priority}] ${s.title}: ${s.description}`).join('\n')}

Provide:
1. Chain-of-thought reasoning about the patient's overall clinical picture
2. Any additional suggestions the rule engine may have missed
3. Risk stratification
4. Any safety concerns

Respond in JSON:
{
  "reasoning_chain": "step by step clinical reasoning",
  "additional_suggestions": [{"type": "...", "title": "...", "description": "...", "priority": N, "guideline": "..."}],
  "risk_level": "low|moderate|high|critical",
  "risk_factors": ["factor1", "factor2"],
  "safety_concerns": ["concern1"],
  "care_gaps": ["gap1"]
}`, { maxTokens: 2048 });

  // Merge results
  const allSuggestions = [
    ...existingRuleSuggestions,
    ...mockResult.suggestions.map(s => ({ ...s, source: 'mock_reasoning' }))
  ];

  if (llmResult && llmResult.additional_suggestions) {
    for (const s of llmResult.additional_suggestions) {
      allSuggestions.push({
        ...s,
        source: 'llm_reasoning',
        suggestion_type: s.type || 'clinical_insight'
      });
    }
  }

  // Deduplicate by title similarity
  const deduped = deduplicateSuggestions(allSuggestions);

  return {
    source: llmResult ? 'llm_augmented' : 'mock_augmented',
    suggestions: deduped,
    reasoning: {
      chain_of_thought: llmResult?.reasoning_chain || mockResult.chain_of_thought.join(' '),
      risk_level: llmResult?.risk_level || (mockResult.suggestions.some(s => s.priority <= 5) ? 'high' : 'moderate'),
      risk_factors: [...(llmResult?.risk_factors || []), ...mockResult.risk_factors],
      safety_concerns: llmResult?.safety_concerns || [],
      care_gaps: llmResult?.care_gaps || []
    },
    disclaimer: 'AI-augmented clinical decision support. All suggestions require provider review and approval.'
  };
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function buildPatientSummary(context) {
  const { patient, problems, medications, allergies, vitals, labs } = context;

  const parts = [];

  if (patient) {
    const age = patient.dob ? calculateAge(patient.dob) : 'Unknown';
    parts.push(`PATIENT: ${patient.first_name} ${patient.last_name}, ${age}yo ${patient.sex || ''}`);
  }

  if (problems?.length > 0) {
    parts.push(`\nPROBLEM LIST:`);
    problems.forEach(p => parts.push(`  - ${p.problem_name} (${p.icd10_code || 'N/A'}) [${p.status}]`));
  }

  if (medications?.length > 0) {
    parts.push(`\nMEDICATIONS:`);
    medications.filter(m => m.status === 'active').forEach(m =>
      parts.push(`  - ${m.medication_name} ${m.dose || ''} ${m.route || ''} ${m.frequency || ''}`)
    );
  }

  if (allergies?.length > 0) {
    parts.push(`\nALLERGIES:`);
    allergies.forEach(a => parts.push(`  - ${a.allergen} (${a.severity || 'unknown'}) → ${a.reaction || 'unknown reaction'}`));
  }

  if (vitals && Object.keys(vitals).length > 0) {
    parts.push(`\nVITALS:`);
    if (vitals.systolic_bp) parts.push(`  BP: ${vitals.systolic_bp}/${vitals.diastolic_bp} mmHg`);
    if (vitals.heart_rate) parts.push(`  HR: ${vitals.heart_rate} bpm`);
    if (vitals.temperature) parts.push(`  Temp: ${vitals.temperature}°F`);
    if (vitals.respiratory_rate) parts.push(`  RR: ${vitals.respiratory_rate}/min`);
    if (vitals.spo2) parts.push(`  SpO2: ${vitals.spo2}%`);
    if (vitals.weight) parts.push(`  Weight: ${vitals.weight} lbs`);
    if (vitals.bmi) parts.push(`  BMI: ${vitals.bmi}`);
  }

  if (labs?.length > 0) {
    parts.push(`\nRECENT LABS:`);
    labs.slice(0, 15).forEach(l =>
      parts.push(`  - ${l.test_name}: ${l.result_value} ${l.units || ''} (ref: ${l.reference_range || 'N/A'}) ${l.abnormal_flag ? '[' + l.abnormal_flag + ']' : ''}`)
    );
  }

  return parts.join('\n');
}

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

function generateMockDifferential(context) {
  const differentials = [];
  const { transcript, chiefComplaint, problems } = context;
  const text = (transcript || '') + ' ' + (chiefComplaint || '');
  const lower = text.toLowerCase();

  if (/chest\s*pain|chest\s*pressure|substernal/i.test(lower)) {
    differentials.push(
      { condition: 'Acute Coronary Syndrome', icd10: 'I24.9', likelihood: 'high', reasoning: 'Chest pain presentation warrants cardiac evaluation', workup: ['EKG', 'Troponin x2', 'BMP'], red_flags: ['Radiation to arm/jaw', 'Diaphoresis', 'Shortness of breath'] },
      { condition: 'GERD', icd10: 'K21.0', likelihood: 'moderate', reasoning: 'Common cause of chest pain', workup: ['Trial PPI', 'Upper GI if refractory'], red_flags: [] },
      { condition: 'Musculoskeletal', icd10: 'M79.3', likelihood: 'moderate', reasoning: 'Reproducible tenderness suggests MSK cause', workup: ['Physical exam'], red_flags: [] },
      { condition: 'Pulmonary Embolism', icd10: 'I26.99', likelihood: 'low', reasoning: 'Must rule out in acute presentation', workup: ['D-dimer', 'CT-PA if positive'], red_flags: ['Recent immobility', 'Tachycardia', 'Pleuritic pain'] }
    );
  }

  if (/shortness\s*of\s*breath|dyspnea|can'?t\s*breathe|SOB/i.test(lower)) {
    const hasCHF = problems?.some(p => p.icd10_code?.startsWith('I50'));
    const hasCOPD = problems?.some(p => p.icd10_code?.startsWith('J44'));

    if (hasCHF) differentials.push({ condition: 'CHF Exacerbation', icd10: 'I50.9', likelihood: 'high', reasoning: 'Known CHF with new dyspnea', workup: ['BNP', 'CXR', 'Echo'], red_flags: ['Weight gain', 'Orthopnea', 'PND'] });
    if (hasCOPD) differentials.push({ condition: 'COPD Exacerbation', icd10: 'J44.1', likelihood: 'high', reasoning: 'Known COPD with new dyspnea', workup: ['CXR', 'ABG', 'Procalcitonin'], red_flags: ['Increased sputum', 'Fever', 'Wheezing'] });

    differentials.push(
      { condition: 'Pneumonia', icd10: 'J18.9', likelihood: 'moderate', reasoning: 'Infectious cause of acute dyspnea', workup: ['CXR', 'CBC', 'Procalcitonin'], red_flags: ['Fever', 'Productive cough'] }
    );
  }

  if (/blood\s*sugar|glucose|A1C|sugars?\s*(?:high|elevated|running)/i.test(lower)) {
    differentials.push(
      { condition: 'Uncontrolled Type 2 Diabetes', icd10: 'E11.65', likelihood: 'high', reasoning: 'Elevated glucose/A1C in known diabetic', workup: ['A1C', 'BMP', 'Medication adherence review'], red_flags: ['DKA symptoms', 'Significant weight loss'] },
      { condition: 'Medication Non-Adherence', icd10: 'Z91.120', likelihood: 'moderate', reasoning: 'Common cause of uncontrolled diabetes', workup: ['Medication reconciliation', 'Pharmacy fill history'], red_flags: [] }
    );
  }

  return {
    source: 'mock',
    differentials,
    most_likely: differentials[0]?.condition || 'Insufficient data for differential',
    urgent_considerations: differentials.flatMap(d => d.red_flags).filter(Boolean),
    reasoning_chain: 'Pattern-based differential (LLM unavailable). Provider clinical judgment required.',
    disclaimer: 'Basic pattern-matched differential. Provider review required.'
  };
}

function deduplicateSuggestions(suggestions) {
  const seen = new Map();
  const result = [];

  for (const s of suggestions) {
    const key = (s.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 40);
    if (!seen.has(key)) {
      seen.set(key, true);
      result.push(s);
    } else {
      // Keep higher priority (lower number = higher priority)
      const existing = result.find(r =>
        (r.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 40) === key
      );
      if (existing && (s.priority || 50) < (existing.priority || 50)) {
        Object.assign(existing, s);
      }
    }
  }

  return result.sort((a, b) => (a.priority || 50) - (b.priority || 50));
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  augmentedClinicalReasoning,
  generateDifferentialDiagnosis,
  generateTreatmentPlan,
  mockClinicalReasoning,
  buildPatientSummary,
  callLLM,
  isLLMAvailable: () => !!(ANTHROPIC_API_KEY && AI_MODE === 'api'),
  isEnabled: () => LLM_CDS_ENABLED
};
