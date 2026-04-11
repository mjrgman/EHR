/**
 * Functional Medicine — Pattern Detection Rules
 *
 * These rules detect metabolic, adrenal, thyroid, and methylation patterns
 * that are commonly evaluated in functional medicine practice. Unlike the
 * HRT and peptide rules, most of these are INFORMATIONAL — they emit
 * `FUNCTIONAL_PATTERN_DETECTED` events rather than dosing recommendations.
 *
 * Rules that DO recommend supplement or medication changes carry the
 * `requiresDosingApproval: true` flag and route through the Tier 3 gate
 * just like the HRT/peptide rules.
 *
 * EVIDENCE NOTE:
 *   Functional medicine sits between guideline-driven primary care and
 *   research literature. Every rule cites the best available source, but
 *   the evidence base is narrower than conventional CDS rules. Physicians
 *   using this module must apply clinical judgment.
 */

const FUNCTIONAL_MED_RULES = [
  // ==========================================
  // METABOLIC / INSULIN RESISTANCE PATTERNS
  // ==========================================
  {
    id: 'fm-insulin-resistance-pattern',
    rule_name: 'Insulin Resistance Pattern (HOMA-IR / Fasting Insulin)',
    rule_type: 'functional_pattern',
    category: 'metabolic',
    priority: 40,
    trigger_condition: {
      any_of: [
        { lab: { code: 'fasting_insulin', operator: '>', value: 10, unit: 'uIU/mL' } },
        { lab: { code: 'homa_ir', operator: '>', value: 2.5 } },
        { and: [
          { lab: { code: 'triglycerides', operator: '>', value: 150 } },
          { lab: { code: 'hdl', operator: '<', value: 40 } }
        ]}
      ]
    },
    suggested_actions: {
      title: 'Insulin Resistance Pattern Detected',
      description: 'Labs suggest insulin resistance (elevated fasting insulin, HOMA-IR > 2.5, or atherogenic lipid pattern). Consider low-glycemic dietary intervention, resistance training, and metformin if appropriate. Recheck fasting insulin + glucose in 12 weeks.',
      actions: [
        { type: 'recommend_lab', payload: { test_name: 'Fasting Insulin', indication: 'Quantify insulin resistance' } },
        { type: 'recommend_lab', payload: { test_name: 'Hemoglobin A1C', indication: 'Glycemic marker' } },
        { type: 'patient_counseling', payload: { topics: ['Low-glycemic diet', 'Resistance training 2-3x/week', 'Sleep hygiene (7-9 hours)'] } }
      ],
      emitEvent: 'FUNCTIONAL_PATTERN_DETECTED'
    },
    evidence_source: 'Matthews DR et al. Diabetologia 1985 (HOMA-IR methodology); ADA 2025 Standards of Care on prediabetes screening; Kraft JR. Diabetes Epidemic & You (fasting insulin as early marker).'
  },

  // ==========================================
  // THYROID OPTIMIZATION
  // ==========================================
  {
    id: 'fm-subclinical-hypothyroid',
    rule_name: 'Subclinical Hypothyroidism Pattern',
    rule_type: 'functional_pattern',
    category: 'thyroid',
    priority: 35,
    trigger_condition: {
      lab: { code: 'tsh', operator: 'between', value: [4.5, 10.0], unit: 'mIU/L' },
      optional_lab: { code: 'free_t4', operator: 'within', value: 'reference_range' }
    },
    suggested_actions: {
      title: 'Subclinical Hypothyroidism',
      description: 'TSH 4.5–10 with normal free T4. Check TPO antibodies (Hashimoto workup), free T3, reverse T3. Consider treatment if symptomatic, TPO positive, pregnant/planning, or TSH trending up.',
      actions: [
        { type: 'recommend_lab', payload: { test_name: 'TPO Antibodies', indication: 'Autoimmune thyroiditis workup' } },
        { type: 'recommend_lab', payload: { test_name: 'Free T3', indication: 'Active thyroid hormone' } },
        { type: 'recommend_lab', payload: { test_name: 'Reverse T3', indication: 'Peripheral thyroid conversion' } }
      ],
      emitEvent: 'FUNCTIONAL_PATTERN_DETECTED'
    },
    evidence_source: 'American Thyroid Association 2014 Guidelines for Treatment of Hypothyroidism; Endocrine Society: subclinical hypothyroidism workup and treatment decisions.'
  },
  {
    id: 'fm-hashimoto-pattern',
    rule_name: 'Hashimoto Thyroiditis Pattern',
    rule_type: 'functional_pattern',
    category: 'thyroid',
    priority: 35,
    trigger_condition: {
      lab: { code: 'tpo_antibody', operator: '>', value: 35, unit: 'IU/mL' }
    },
    suggested_actions: {
      title: 'Hashimoto Thyroiditis Pattern (Elevated TPO)',
      description: 'TPO antibodies elevated — consistent with Hashimoto thyroiditis. Monitor TSH every 6–12 months even if currently euthyroid. Consider gluten-free trial and selenium 200 mcg/day (mixed evidence for autoimmunity reduction).',
      actions: [
        { type: 'recommend_lab', payload: { test_name: 'TSH, Free T4, Free T3 (q6-12mo)', indication: 'Monitor for progression' } },
        { type: 'patient_counseling', payload: { topics: ['Autoimmune thyroiditis — gradual thyroid function decline possible', 'Selenium may help (limited data)', 'Gluten trial has mixed evidence'] } }
      ],
      emitEvent: 'FUNCTIONAL_PATTERN_DETECTED'
    },
    evidence_source: 'ATA 2014 Guidelines; Toulis KA et al. Thyroid 2010 (selenium meta-analysis).'
  },

  // ==========================================
  // METHYLATION / B-VITAMIN PATTERNS
  // ==========================================
  {
    id: 'fm-methylation-pattern',
    rule_name: 'Functional B12 / Methylation Deficit Pattern',
    rule_type: 'functional_pattern',
    category: 'methylation',
    priority: 45,
    trigger_condition: {
      any_of: [
        { lab: { code: 'b12', operator: '<', value: 400, unit: 'pg/mL' } },
        { lab: { code: 'homocysteine', operator: '>', value: 10, unit: 'umol/L' } },
        { lab: { code: 'mma', operator: '>', value: 0.4, unit: 'umol/L' } }
      ]
    },
    suggested_actions: {
      title: 'Functional B12 / Methylation Pattern',
      description: 'Labs suggest functional B12 insufficiency or impaired methylation (low-normal B12, elevated homocysteine, or elevated MMA). Consider methylated B-complex supplementation and MTHFR context if elevated homocysteine persists.',
      actions: [
        { type: 'recommend_lab', payload: { test_name: 'Homocysteine', indication: 'Methylation marker' } },
        { type: 'recommend_lab', payload: { test_name: 'Methylmalonic Acid (MMA)', indication: 'Functional B12 marker' } }
      ],
      emitEvent: 'FUNCTIONAL_PATTERN_DETECTED'
    },
    evidence_source: 'Smith AD et al. BMJ 2018 (homocysteine and B-vitamin supplementation); Herrmann W et al. (functional markers of B12 status).'
  },

  // ==========================================
  // HPA AXIS / CORTISOL PATTERNS
  // ==========================================
  {
    id: 'fm-hpa-dysfunction',
    rule_name: 'HPA Axis Dysfunction Pattern',
    rule_type: 'functional_pattern',
    category: 'adrenal',
    priority: 45,
    trigger_condition: {
      symptoms_any: ['chronic fatigue', 'morning fatigue', 'afternoon crash', 'salt craving', 'orthostatic dizziness'],
      optional_lab: { code: 'cortisol_am', operator: '<', value: 10, unit: 'ug/dL' }
    },
    suggested_actions: {
      title: 'HPA Axis / Cortisol Dysregulation Pattern',
      description: 'Symptoms and/or labs suggest HPA axis dysregulation. Rule out Addison disease with AM cortisol and ACTH stimulation if indicated. For subclinical HPA dysfunction, focus on sleep hygiene, circadian light exposure, and stress reduction. Adaptogens (ashwagandha, rhodiola) have modest evidence.',
      actions: [
        { type: 'recommend_lab', payload: { test_name: 'AM Cortisol (8am)', indication: 'Screen for adrenal insufficiency' } },
        { type: 'recommend_lab', payload: { test_name: '4-point Salivary Cortisol or DUTCH test', indication: 'Diurnal pattern', educational_only: true } }
      ],
      emitEvent: 'FUNCTIONAL_PATTERN_DETECTED'
    },
    evidence_source: 'Endocrine Society: adrenal insufficiency workup; Lopresti AL et al. Medicine 2019 (ashwagandha + cortisol).'
  },

  // ==========================================
  // INFLAMMATION / CRP PATTERNS
  // ==========================================
  {
    id: 'fm-chronic-inflammation',
    rule_name: 'Chronic Low-Grade Inflammation',
    rule_type: 'functional_pattern',
    category: 'inflammation',
    priority: 40,
    trigger_condition: {
      any_of: [
        { lab: { code: 'hs_crp', operator: '>', value: 3.0, unit: 'mg/L' } },
        { lab: { code: 'fibrinogen', operator: '>', value: 400, unit: 'mg/dL' } },
        { lab: { code: 'ferritin', operator: '>', value: 300, unit: 'ng/mL' } }
      ]
    },
    suggested_actions: {
      title: 'Chronic Inflammation Pattern',
      description: 'Elevated inflammatory markers (hs-CRP, fibrinogen, or ferritin). Evaluate for common drivers: metabolic syndrome, hidden infection, autoimmunity, visceral obesity. Consider anti-inflammatory dietary intervention, omega-3s, and recheck in 8–12 weeks.',
      actions: [
        { type: 'recommend_lab', payload: { test_name: 'Complete Metabolic Panel + Lipid Panel', indication: 'Screen for contributors' } },
        { type: 'patient_counseling', payload: { topics: ['Mediterranean or anti-inflammatory diet', 'Omega-3 fatty acids 2 g/day', 'Weight management if BMI elevated'] } }
      ],
      emitEvent: 'FUNCTIONAL_PATTERN_DETECTED'
    },
    evidence_source: 'AHA/CDC scientific statement on hs-CRP for CV risk (Pearson TA et al. Circulation 2003); Estruch R et al. NEJM 2013 (PREDIMED Mediterranean diet).'
  },

  // ==========================================
  // VITAMIN D INSUFFICIENCY
  // ==========================================
  {
    id: 'fm-vitd-insufficient',
    rule_name: 'Vitamin D Insufficiency',
    rule_type: 'functional_pattern',
    category: 'micronutrient',
    priority: 50,
    trigger_condition: {
      lab: { code: '25_oh_vitamin_d', operator: '<', value: 30, unit: 'ng/mL' }
    },
    suggested_actions: {
      title: 'Vitamin D Insufficiency',
      description: '25-OH vitamin D below 30 ng/mL. Consider vitamin D3 supplementation 2,000–4,000 IU/day (adjust to target 40–60 ng/mL). Recheck in 3 months.',
      actions: [
        {
          type: 'dose_adjustment',
          requiresDosingApproval: true,
          payload: {
            medication: 'Vitamin D3 (cholecalciferol)',
            currentDose: null,
            proposedDose: '2,000 IU daily',
            route: 'oral',
            frequency: 'daily',
            rationale: '25-OH vitamin D below 30 ng/mL — replete to target 40–60 ng/mL'
          }
        },
        { type: 'recommend_lab', payload: { test_name: '25-OH Vitamin D (recheck in 3 months)', indication: 'Monitor replacement response' } }
      ],
      emitEvent: 'FUNCTIONAL_PATTERN_DETECTED'
    },
    evidence_source: 'Endocrine Society 2011 Clinical Practice Guideline: Evaluation, Treatment, and Prevention of Vitamin D Deficiency.'
  }
];

module.exports = { FUNCTIONAL_MED_RULES };
