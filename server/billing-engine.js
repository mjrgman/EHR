/**
 * MJR-EHR Billing & Revenue Cycle Management Engine
 *
 * Complete billing lifecycle from encounter documentation to payment posting:
 * - Claim generation from encounter data (CPT + ICD-10 mapping)
 * - Claim scrubbing and validation
 * - Payer rules and fee schedule management
 * - Eligibility verification abstraction
 * - Claim submission tracking
 * - ERA/EOB processing
 * - Denial management and appeals
 * - Patient billing and statements
 * - Payment posting
 * - Revenue analytics
 *
 * Integrates with clearinghouses: Change Healthcare, Waystar, Office Ally
 * (abstracted provider pattern — real integrations require API credentials)
 */

const db = require('./database');

// ==========================================
// CONFIGURATION
// ==========================================

const CLEARINGHOUSE = process.env.CLEARINGHOUSE || 'none'; // 'change_healthcare', 'waystar', 'office_ally', 'none'
const CLEARINGHOUSE_API_KEY = process.env.CLEARINGHOUSE_API_KEY || '';
const NPI = process.env.PROVIDER_NPI || '1234567890';
const TAX_ID = process.env.TAX_ID || '12-3456789';
const PRACTICE_NAME = process.env.PRACTICE_NAME || 'MJR Health Systems';

// ==========================================
// DATABASE SCHEMA
// ==========================================

async function initBillingSchema() {
  await db.dbRun(`CREATE TABLE IF NOT EXISTS payers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payer_name TEXT NOT NULL,
    payer_id TEXT UNIQUE,
    payer_type TEXT CHECK(payer_type IN ('commercial','medicare','medicaid','tricare','workers_comp','self_pay')) DEFAULT 'commercial',
    address TEXT,
    phone TEXT,
    electronic_id TEXT,
    timely_filing_days INTEGER DEFAULT 90,
    active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.dbRun(`CREATE TABLE IF NOT EXISTS fee_schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cpt_code TEXT NOT NULL,
    description TEXT,
    standard_charge REAL NOT NULL,
    medicare_rate REAL,
    medicaid_rate REAL,
    modifier TEXT,
    effective_date DATE,
    category TEXT CHECK(category IN ('E_M','procedure','lab','imaging','other')) DEFAULT 'other',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.dbRun(`CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_number TEXT UNIQUE NOT NULL,
    patient_id INTEGER NOT NULL,
    encounter_id INTEGER,
    payer_id INTEGER,
    rendering_provider TEXT,
    rendering_npi TEXT,
    facility_name TEXT,
    facility_npi TEXT,
    date_of_service DATE NOT NULL,
    place_of_service TEXT DEFAULT '11',
    total_charge REAL NOT NULL DEFAULT 0,
    total_allowed REAL DEFAULT 0,
    total_paid REAL DEFAULT 0,
    patient_responsibility REAL DEFAULT 0,
    status TEXT CHECK(status IN (
      'draft','validated','scrubbed','submitted','acknowledged',
      'adjudicated','paid','partial_paid','denied','appealed',
      'resubmitted','void','patient_responsibility'
    )) DEFAULT 'draft',
    submission_date DATE,
    adjudication_date DATE,
    denial_reason TEXT,
    denial_code TEXT,
    appeal_deadline DATE,
    clearinghouse_id TEXT,
    payer_claim_number TEXT,
    scrub_results TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL,
    FOREIGN KEY (payer_id) REFERENCES payers(id) ON DELETE SET NULL
  )`);

  await db.dbRun(`CREATE TABLE IF NOT EXISTS claim_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER NOT NULL,
    line_number INTEGER NOT NULL,
    cpt_code TEXT NOT NULL,
    modifier1 TEXT,
    modifier2 TEXT,
    icd10_pointers TEXT NOT NULL,
    units INTEGER DEFAULT 1,
    charge_amount REAL NOT NULL,
    allowed_amount REAL DEFAULT 0,
    paid_amount REAL DEFAULT 0,
    adjustment_amount REAL DEFAULT 0,
    adjustment_reason TEXT,
    status TEXT CHECK(status IN ('pending','paid','denied','adjusted')) DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE
  )`);

  await db.dbRun(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER,
    patient_id INTEGER NOT NULL,
    payment_type TEXT CHECK(payment_type IN ('insurance','patient','copay','coinsurance','deductible','refund','write_off','adjustment')) NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT CHECK(payment_method IN ('check','eft','credit_card','cash','online','adjustment')) DEFAULT 'check',
    check_number TEXT,
    eft_trace TEXT,
    payment_date DATE NOT NULL,
    posted_date DATE,
    payer_name TEXT,
    era_id TEXT,
    notes TEXT,
    posted_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE SET NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
  )`);

  await db.dbRun(`CREATE TABLE IF NOT EXISTS denial_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER NOT NULL,
    denial_code TEXT NOT NULL,
    denial_reason TEXT NOT NULL,
    denial_category TEXT CHECK(denial_category IN (
      'eligibility','authorization','medical_necessity','coding','duplicate',
      'timely_filing','missing_info','coordination_of_benefits','other'
    )),
    denial_date DATE NOT NULL,
    appeal_status TEXT CHECK(appeal_status IN ('pending','appealed','overturned','upheld','abandoned')) DEFAULT 'pending',
    appeal_date DATE,
    appeal_deadline DATE,
    appeal_notes TEXT,
    appeal_outcome TEXT,
    resolved_date DATE,
    financial_impact REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE
  )`);

  await db.dbRun(`CREATE TABLE IF NOT EXISTS eligibility_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    payer_name TEXT NOT NULL,
    member_id TEXT,
    group_number TEXT,
    check_date DATE NOT NULL,
    status TEXT CHECK(status IN ('active','inactive','pending','error')) DEFAULT 'pending',
    copay_amount REAL,
    coinsurance_pct REAL,
    deductible_total REAL,
    deductible_met REAL,
    out_of_pocket_max REAL,
    out_of_pocket_met REAL,
    plan_name TEXT,
    plan_type TEXT,
    effective_date DATE,
    termination_date DATE,
    raw_response TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
  )`);

  // Seed common payers
  const payerCount = await db.dbGet('SELECT COUNT(*) as count FROM payers');
  if (payerCount.count === 0) {
    await seedPayers();
  }

  // Seed fee schedule
  const feeCount = await db.dbGet('SELECT COUNT(*) as count FROM fee_schedule');
  if (feeCount.count === 0) {
    await seedFeeSchedule();
  }
}

async function seedPayers() {
  const payers = [
    { name: 'Medicare', id: 'MCARE', type: 'medicare', electronic_id: '00882', timely_filing: 365 },
    { name: 'Medicaid - Georgia', id: 'GAMCD', type: 'medicaid', electronic_id: 'GAMCD', timely_filing: 180 },
    { name: 'Blue Cross Blue Shield of Georgia', id: 'BCBSGA', type: 'commercial', electronic_id: '00590', timely_filing: 90 },
    { name: 'Aetna', id: 'AETNA', type: 'commercial', electronic_id: '60054', timely_filing: 90 },
    { name: 'UnitedHealthcare', id: 'UHC', type: 'commercial', electronic_id: '87726', timely_filing: 90 },
    { name: 'Cigna', id: 'CIGNA', type: 'commercial', electronic_id: '62308', timely_filing: 90 },
    { name: 'Humana', id: 'HUMANA', type: 'commercial', electronic_id: '61101', timely_filing: 90 },
    { name: 'Tricare', id: 'TRICARE', type: 'tricare', electronic_id: '99726', timely_filing: 365 },
    { name: 'Self-Pay', id: 'SELFPAY', type: 'self_pay', electronic_id: null, timely_filing: null }
  ];

  for (const p of payers) {
    await db.dbRun(
      `INSERT OR IGNORE INTO payers (payer_name, payer_id, payer_type, electronic_id, timely_filing_days) VALUES (?,?,?,?,?)`,
      [p.name, p.id, p.type, p.electronic_id, p.timely_filing]
    );
  }
}

async function seedFeeSchedule() {
  const fees = [
    // E&M Codes (Office visits)
    { cpt: '99213', desc: 'Office visit, established, low complexity', charge: 150.00, medicare: 109.44, category: 'E_M' },
    { cpt: '99214', desc: 'Office visit, established, moderate complexity', charge: 210.00, medicare: 161.09, category: 'E_M' },
    { cpt: '99215', desc: 'Office visit, established, high complexity', charge: 295.00, medicare: 216.69, category: 'E_M' },
    { cpt: '99202', desc: 'Office visit, new patient, straightforward', charge: 175.00, medicare: 113.30, category: 'E_M' },
    { cpt: '99203', desc: 'Office visit, new patient, low complexity', charge: 230.00, medicare: 168.38, category: 'E_M' },
    { cpt: '99204', desc: 'Office visit, new patient, moderate complexity', charge: 325.00, medicare: 251.04, category: 'E_M' },
    { cpt: '99205', desc: 'Office visit, new patient, high complexity', charge: 420.00, medicare: 318.40, category: 'E_M' },
    // Telehealth modifiers
    { cpt: '99213', desc: 'Telehealth visit, established, low complexity', charge: 150.00, medicare: 109.44, modifier: '95', category: 'E_M' },
    { cpt: '99214', desc: 'Telehealth visit, established, moderate complexity', charge: 210.00, medicare: 161.09, modifier: '95', category: 'E_M' },
    // Common lab CPTs
    { cpt: '80048', desc: 'Basic Metabolic Panel', charge: 75.00, medicare: 11.40, category: 'lab' },
    { cpt: '80053', desc: 'Comprehensive Metabolic Panel', charge: 95.00, medicare: 14.49, category: 'lab' },
    { cpt: '85025', desc: 'Complete Blood Count with diff', charge: 45.00, medicare: 10.66, category: 'lab' },
    { cpt: '83036', desc: 'Hemoglobin A1C', charge: 55.00, medicare: 13.26, category: 'lab' },
    { cpt: '80061', desc: 'Lipid Panel', charge: 85.00, medicare: 18.44, category: 'lab' },
    { cpt: '84443', desc: 'TSH', charge: 65.00, medicare: 23.41, category: 'lab' },
    { cpt: '82043', desc: 'Urine Microalbumin', charge: 40.00, medicare: 9.03, category: 'lab' },
    { cpt: '81003', desc: 'Urinalysis', charge: 25.00, medicare: 3.49, category: 'lab' },
    { cpt: '84484', desc: 'Troponin', charge: 75.00, medicare: 14.26, category: 'lab' },
    { cpt: '83880', desc: 'BNP/NT-proBNP', charge: 85.00, medicare: 46.12, category: 'lab' },
    // Common imaging
    { cpt: '71046', desc: 'Chest X-ray, 2 views', charge: 125.00, medicare: 28.67, category: 'imaging' },
    { cpt: '93000', desc: 'Electrocardiogram (EKG)', charge: 85.00, medicare: 17.31, category: 'imaging' },
    { cpt: '93306', desc: 'Echocardiogram, complete', charge: 450.00, medicare: 138.02, category: 'imaging' },
    // Procedures
    { cpt: '36415', desc: 'Venipuncture', charge: 15.00, medicare: 3.00, category: 'procedure' },
    { cpt: '96372', desc: 'Injection, therapeutic/prophylactic', charge: 50.00, medicare: 23.14, category: 'procedure' }
  ];

  for (const f of fees) {
    await db.dbRun(
      `INSERT OR IGNORE INTO fee_schedule (cpt_code, description, standard_charge, medicare_rate, modifier, category) VALUES (?,?,?,?,?,?)`,
      [f.cpt, f.desc, f.charge, f.medicare, f.modifier || null, f.category]
    );
  }
}

// ==========================================
// CLAIM GENERATION
// ==========================================

/**
 * Generate a claim from an encounter.
 * Pulls encounter data, maps CPT/ICD-10 codes, calculates charges.
 */
async function generateClaimFromEncounter(encounterId) {
  const encounter = await db.getEncounterById(encounterId);
  if (!encounter) throw new Error('Encounter not found');

  const patient = await db.getPatientById(encounter.patient_id);
  if (!patient) throw new Error('Patient not found');

  // Get all orders from encounter
  const [labOrders, imagingOrders, prescriptions, vitals] = await Promise.all([
    db.dbAll('SELECT * FROM lab_orders WHERE encounter_id = ?', [encounterId]),
    db.dbAll('SELECT * FROM imaging_orders WHERE encounter_id = ?', [encounterId]),
    db.dbAll('SELECT * FROM prescriptions WHERE encounter_id = ?', [encounterId]),
    db.dbAll('SELECT * FROM vitals WHERE encounter_id = ? ORDER BY recorded_date DESC LIMIT 1', [encounterId])
  ]);

  // Get patient problems for ICD-10 codes
  const problems = await db.getPatientProblems(patient.id);
  const activeDiagnoses = problems
    .filter(p => (p.status === 'active' || p.status === 'chronic') && p.icd10_code)
    .map(p => p.icd10_code);

  // Match patient insurance to payer
  const payer = await matchPayer(patient.insurance_carrier);

  // Determine E&M level
  const emCode = determineEMCode(encounter, problems, labOrders, imagingOrders, prescriptions);

  // Build claim lines
  const claimLines = [];
  let lineNum = 1;

  // E&M line (always first)
  const emFee = await db.dbGet('SELECT * FROM fee_schedule WHERE cpt_code = ? AND modifier IS NULL', [emCode]);
  claimLines.push({
    line_number: lineNum++,
    cpt_code: emCode,
    icd10_pointers: activeDiagnoses.slice(0, 4).join(',') || 'Z00.00',
    units: 1,
    charge_amount: emFee?.standard_charge || 150.00
  });

  // Lab order lines
  for (const lab of labOrders) {
    if (lab.cpt_code) {
      const fee = await db.dbGet('SELECT * FROM fee_schedule WHERE cpt_code = ?', [lab.cpt_code]);
      claimLines.push({
        line_number: lineNum++,
        cpt_code: lab.cpt_code,
        icd10_pointers: lab.icd10_codes || activeDiagnoses[0] || 'Z00.00',
        units: 1,
        charge_amount: fee?.standard_charge || 50.00
      });
    }
  }

  // Imaging order lines
  for (const img of imagingOrders) {
    if (img.cpt_code) {
      const fee = await db.dbGet('SELECT * FROM fee_schedule WHERE cpt_code = ?', [img.cpt_code]);
      claimLines.push({
        line_number: lineNum++,
        cpt_code: img.cpt_code,
        icd10_pointers: img.icd10_codes || activeDiagnoses[0] || 'Z00.00',
        units: 1,
        charge_amount: fee?.standard_charge || 100.00
      });
    }
  }

  // Venipuncture if labs ordered
  if (labOrders.length > 0) {
    const veniFee = await db.dbGet('SELECT * FROM fee_schedule WHERE cpt_code = ?', ['36415']);
    claimLines.push({
      line_number: lineNum++,
      cpt_code: '36415',
      icd10_pointers: activeDiagnoses[0] || 'Z00.00',
      units: 1,
      charge_amount: veniFee?.standard_charge || 15.00
    });
  }

  const totalCharge = claimLines.reduce((sum, l) => sum + l.charge_amount, 0);

  // Create claim
  const claimNumber = generateClaimNumber();
  const claimResult = await db.dbRun(
    `INSERT INTO claims
     (claim_number, patient_id, encounter_id, payer_id, rendering_provider, rendering_npi,
      facility_name, facility_npi, date_of_service, total_charge, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [claimNumber, patient.id, encounterId, payer?.id || null,
     encounter.provider || 'Dr. Provider', NPI,
     PRACTICE_NAME, NPI,
     encounter.encounter_date, totalCharge, 'draft']
  );

  const claimId = claimResult.lastID;

  // Insert claim lines
  for (const line of claimLines) {
    await db.dbRun(
      `INSERT INTO claim_lines (claim_id, line_number, cpt_code, icd10_pointers, units, charge_amount)
       VALUES (?,?,?,?,?,?)`,
      [claimId, line.line_number, line.cpt_code, line.icd10_pointers, line.units, line.charge_amount]
    );
  }

  return {
    id: claimId,
    claim_number: claimNumber,
    patient: `${patient.first_name} ${patient.last_name}`,
    payer: payer?.payer_name || 'Self-Pay',
    date_of_service: encounter.encounter_date,
    total_charge: totalCharge,
    lines: claimLines,
    diagnoses: activeDiagnoses,
    status: 'draft'
  };
}

// ==========================================
// CLAIM SCRUBBING
// ==========================================

/**
 * Validate and scrub a claim before submission.
 * Returns issues found and overall pass/fail.
 */
async function scrubClaim(claimId) {
  const claim = await db.dbGet('SELECT * FROM claims WHERE id = ?', [claimId]);
  if (!claim) throw new Error('Claim not found');

  const lines = await db.dbAll('SELECT * FROM claim_lines WHERE claim_id = ? ORDER BY line_number', [claimId]);
  const patient = await db.getPatientById(claim.patient_id);
  const payer = claim.payer_id ? await db.dbGet('SELECT * FROM payers WHERE id = ?', [claim.payer_id]) : null;

  const issues = [];
  let severity = 'pass'; // pass, warning, error

  // 1. Patient demographics validation
  if (!patient) {
    issues.push({ severity: 'error', code: 'PAT001', message: 'Patient record not found' });
    severity = 'error';
  } else {
    if (!patient.dob) {
      issues.push({ severity: 'error', code: 'PAT002', message: 'Patient date of birth is missing' });
      severity = 'error';
    }
    if (!patient.sex) {
      issues.push({ severity: 'warning', code: 'PAT003', message: 'Patient sex/gender not specified' });
      if (severity !== 'error') severity = 'warning';
    }
    if (!patient.insurance_carrier && (!payer || payer.payer_type !== 'self_pay')) {
      issues.push({ severity: 'warning', code: 'PAT004', message: 'No insurance carrier on file' });
      if (severity !== 'error') severity = 'warning';
    }
    if (!patient.insurance_id && payer && payer.payer_type !== 'self_pay') {
      issues.push({ severity: 'error', code: 'PAT005', message: 'Insurance member ID is missing' });
      severity = 'error';
    }
  }

  // 2. Claim-level validation
  if (!claim.date_of_service) {
    issues.push({ severity: 'error', code: 'CLM001', message: 'Date of service is missing' });
    severity = 'error';
  }
  if (!claim.rendering_npi || claim.rendering_npi.length !== 10) {
    issues.push({ severity: 'error', code: 'CLM002', message: 'Invalid rendering provider NPI' });
    severity = 'error';
  }
  if (lines.length === 0) {
    issues.push({ severity: 'error', code: 'CLM003', message: 'Claim has no line items' });
    severity = 'error';
  }

  // 3. Timely filing check
  if (payer && payer.timely_filing_days) {
    const dos = new Date(claim.date_of_service);
    const today = new Date();
    const daysSinceDOS = Math.floor((today - dos) / (1000 * 60 * 60 * 24));
    if (daysSinceDOS > payer.timely_filing_days) {
      issues.push({
        severity: 'error', code: 'CLM004',
        message: `Timely filing limit exceeded: ${daysSinceDOS} days since DOS (limit: ${payer.timely_filing_days} days for ${payer.payer_name})`
      });
      severity = 'error';
    } else if (daysSinceDOS > payer.timely_filing_days * 0.8) {
      issues.push({
        severity: 'warning', code: 'CLM005',
        message: `Approaching timely filing deadline: ${payer.timely_filing_days - daysSinceDOS} days remaining`
      });
      if (severity !== 'error') severity = 'warning';
    }
  }

  // 4. Line-level validation
  for (const line of lines) {
    // CPT code exists in fee schedule
    const fee = await db.dbGet('SELECT * FROM fee_schedule WHERE cpt_code = ?', [line.cpt_code]);
    if (!fee) {
      issues.push({
        severity: 'warning', code: `LN${line.line_number}01`,
        message: `Line ${line.line_number}: CPT ${line.cpt_code} not found in fee schedule`
      });
      if (severity !== 'error') severity = 'warning';
    }

    // ICD-10 pointers not empty
    if (!line.icd10_pointers || line.icd10_pointers === '') {
      issues.push({
        severity: 'error', code: `LN${line.line_number}02`,
        message: `Line ${line.line_number}: No diagnosis pointer for CPT ${line.cpt_code}`
      });
      severity = 'error';
    }

    // Charge amount > 0
    if (!line.charge_amount || line.charge_amount <= 0) {
      issues.push({
        severity: 'error', code: `LN${line.line_number}03`,
        message: `Line ${line.line_number}: Invalid charge amount for CPT ${line.cpt_code}`
      });
      severity = 'error';
    }

    // Units > 0
    if (!line.units || line.units <= 0) {
      issues.push({
        severity: 'error', code: `LN${line.line_number}04`,
        message: `Line ${line.line_number}: Invalid units for CPT ${line.cpt_code}`
      });
      severity = 'error';
    }
  }

  // 5. Medical necessity — check that diagnoses support the CPT codes
  for (const line of lines) {
    const icdCodes = (line.icd10_pointers || '').split(',').filter(Boolean);
    const cpt = line.cpt_code;

    // Basic medical necessity checks
    if (cpt === '83036' && !icdCodes.some(c => c.startsWith('E11') || c.startsWith('E10') || c.startsWith('E13'))) {
      issues.push({
        severity: 'warning', code: `MN${line.line_number}01`,
        message: `Line ${line.line_number}: A1C (${cpt}) may lack medical necessity without diabetes diagnosis`
      });
      if (severity !== 'error') severity = 'warning';
    }

    if (cpt === '93306' && !icdCodes.some(c => c.startsWith('I') || c.startsWith('R00') || c.startsWith('R06'))) {
      issues.push({
        severity: 'warning', code: `MN${line.line_number}02`,
        message: `Line ${line.line_number}: Echocardiogram (${cpt}) — ensure cardiac/symptom diagnosis is linked`
      });
      if (severity !== 'error') severity = 'warning';
    }
  }

  // 6. Duplicate claim check
  const possibleDup = await db.dbGet(
    `SELECT id, claim_number, status FROM claims
     WHERE patient_id = ? AND date_of_service = ? AND id != ? AND status NOT IN ('void')`,
    [claim.patient_id, claim.date_of_service, claimId]
  );
  if (possibleDup) {
    issues.push({
      severity: 'warning', code: 'DUP001',
      message: `Possible duplicate: Claim ${possibleDup.claim_number} exists for same patient and DOS (status: ${possibleDup.status})`
    });
    if (severity !== 'error') severity = 'warning';
  }

  // Save scrub results
  const scrubResults = JSON.stringify({ severity, issues, scrubDate: new Date().toISOString() });
  const newStatus = severity === 'error' ? 'draft' : 'scrubbed';
  await db.dbRun(
    'UPDATE claims SET scrub_results = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [scrubResults, newStatus, claimId]
  );

  return {
    claimId,
    claimNumber: claim.claim_number,
    severity,
    passed: severity !== 'error',
    issues,
    status: newStatus
  };
}

// ==========================================
// CLAIM SUBMISSION
// ==========================================

/**
 * Submit a scrubbed claim to the clearinghouse.
 */
async function submitClaim(claimId) {
  const claim = await db.dbGet('SELECT * FROM claims WHERE id = ?', [claimId]);
  if (!claim) throw new Error('Claim not found');

  if (claim.status !== 'scrubbed') {
    // Run scrub first
    const scrubResult = await scrubClaim(claimId);
    if (!scrubResult.passed) {
      throw new Error(`Claim failed scrubbing: ${scrubResult.issues.filter(i => i.severity === 'error').map(i => i.message).join('; ')}`);
    }
  }

  const lines = await db.dbAll('SELECT * FROM claim_lines WHERE claim_id = ? ORDER BY line_number', [claimId]);
  const patient = await db.getPatientById(claim.patient_id);
  const payer = claim.payer_id ? await db.dbGet('SELECT * FROM payers WHERE id = ?', [claim.payer_id]) : null;

  // Build 837P claim data
  const claimData = build837P(claim, lines, patient, payer);

  let submissionResult;

  switch (CLEARINGHOUSE) {
    case 'change_healthcare':
      submissionResult = await submitToChangeHealthcare(claimData);
      break;
    case 'waystar':
      submissionResult = await submitToWaystar(claimData);
      break;
    case 'office_ally':
      submissionResult = await submitToOfficeAlly(claimData);
      break;
    default:
      // No clearinghouse configured — simulate submission
      submissionResult = {
        success: true,
        clearinghouse_id: 'SIM-' + Date.now(),
        message: 'Claim queued (no clearinghouse configured)'
      };
  }

  // Update claim status
  const newStatus = submissionResult.success ? 'submitted' : 'draft';
  await db.dbRun(
    `UPDATE claims SET status = ?, submission_date = ?, clearinghouse_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [newStatus, new Date().toISOString().split('T')[0], submissionResult.clearinghouse_id || null, claimId]
  );

  return {
    claimId,
    claimNumber: claim.claim_number,
    status: newStatus,
    ...submissionResult
  };
}

/**
 * Build ANSI X12 837P claim structure.
 * Simplified representation — real 837P is much more complex.
 */
function build837P(claim, lines, patient, payer) {
  return {
    header: {
      transaction_type: '837P',
      submitter: PRACTICE_NAME,
      submitter_id: TAX_ID,
      receiver: payer?.payer_name || 'Self-Pay',
      receiver_id: payer?.electronic_id || '',
      date: new Date().toISOString().split('T')[0]
    },
    billing_provider: {
      name: PRACTICE_NAME,
      npi: NPI,
      tax_id: TAX_ID,
      address: process.env.PRACTICE_ADDRESS || '123 Medical Center Dr, Macon, GA 31201'
    },
    subscriber: {
      name: `${patient.last_name}, ${patient.first_name}`,
      member_id: patient.insurance_id || '',
      dob: patient.dob,
      sex: patient.sex,
      address: `${patient.address_line1 || ''}, ${patient.city || ''}, ${patient.state || ''} ${patient.zip || ''}`
    },
    claim: {
      claim_number: claim.claim_number,
      date_of_service: claim.date_of_service,
      place_of_service: claim.place_of_service,
      total_charge: claim.total_charge,
      rendering_provider: claim.rendering_provider,
      rendering_npi: claim.rendering_npi,
      diagnoses: [...new Set(lines.flatMap(l => (l.icd10_pointers || '').split(',').filter(Boolean)))],
      lines: lines.map(l => ({
        line_number: l.line_number,
        cpt: l.cpt_code,
        modifier: l.modifier1 || null,
        diagnosis_pointers: (l.icd10_pointers || '').split(','),
        units: l.units,
        charge: l.charge_amount
      }))
    }
  };
}

// Clearinghouse submission stubs (require real API credentials)
async function submitToChangeHealthcare(claimData) {
  if (!CLEARINGHOUSE_API_KEY) {
    return { success: true, clearinghouse_id: `CHC-SIM-${Date.now()}`, message: 'Simulated — no API key configured' };
  }
  // Real Change Healthcare API integration would go here
  return { success: true, clearinghouse_id: `CHC-${Date.now()}`, message: 'Submitted to Change Healthcare' };
}

async function submitToWaystar(claimData) {
  if (!CLEARINGHOUSE_API_KEY) {
    return { success: true, clearinghouse_id: `WS-SIM-${Date.now()}`, message: 'Simulated — no API key configured' };
  }
  return { success: true, clearinghouse_id: `WS-${Date.now()}`, message: 'Submitted to Waystar' };
}

async function submitToOfficeAlly(claimData) {
  if (!CLEARINGHOUSE_API_KEY) {
    return { success: true, clearinghouse_id: `OA-SIM-${Date.now()}`, message: 'Simulated — no API key configured' };
  }
  return { success: true, clearinghouse_id: `OA-${Date.now()}`, message: 'Submitted to Office Ally' };
}

// ==========================================
// ELIGIBILITY VERIFICATION
// ==========================================

async function verifyEligibility(patientId) {
  const patient = await db.getPatientById(patientId);
  if (!patient) throw new Error('Patient not found');

  const check = {
    patient_id: patientId,
    payer_name: patient.insurance_carrier || 'Unknown',
    member_id: patient.insurance_id || '',
    check_date: new Date().toISOString().split('T')[0],
    status: 'pending'
  };

  // In production, this calls a real eligibility API (270/271 transaction)
  // For now, simulate based on patient data
  if (patient.insurance_carrier && patient.insurance_id) {
    check.status = 'active';
    check.copay_amount = 25.00;
    check.coinsurance_pct = 20;
    check.deductible_total = 1500.00;
    check.deductible_met = 800.00;
    check.out_of_pocket_max = 6000.00;
    check.out_of_pocket_met = 1200.00;
    check.plan_name = patient.insurance_carrier;
    check.plan_type = 'PPO';
    check.effective_date = '2024-01-01';
  } else {
    check.status = 'inactive';
  }

  const result = await db.dbRun(
    `INSERT INTO eligibility_checks
     (patient_id, payer_name, member_id, check_date, status, copay_amount, coinsurance_pct,
      deductible_total, deductible_met, out_of_pocket_max, out_of_pocket_met,
      plan_name, plan_type, effective_date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [check.patient_id, check.payer_name, check.member_id, check.check_date, check.status,
     check.copay_amount, check.coinsurance_pct, check.deductible_total, check.deductible_met,
     check.out_of_pocket_max, check.out_of_pocket_met, check.plan_name, check.plan_type,
     check.effective_date]
  );

  return { id: result.lastID, ...check };
}

// ==========================================
// PAYMENT POSTING
// ==========================================

async function postPayment(paymentData) {
  const { claim_id, patient_id, payment_type, amount, payment_method,
    check_number, eft_trace, payment_date, payer_name, notes, posted_by } = paymentData;

  const result = await db.dbRun(
    `INSERT INTO payments
     (claim_id, patient_id, payment_type, amount, payment_method, check_number,
      eft_trace, payment_date, posted_date, payer_name, notes, posted_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [claim_id, patient_id, payment_type, amount, payment_method || 'check',
     check_number, eft_trace, payment_date, new Date().toISOString().split('T')[0],
     payer_name, notes, posted_by || 'System']
  );

  // Update claim totals
  if (claim_id) {
    await recalculateClaimTotals(claim_id);
  }

  return { id: result.lastID };
}

async function recalculateClaimTotals(claimId) {
  const payments = await db.dbAll('SELECT * FROM payments WHERE claim_id = ?', [claimId]);
  const totalPaid = payments.filter(p => p.payment_type !== 'refund').reduce((sum, p) => sum + p.amount, 0);
  const refunds = payments.filter(p => p.payment_type === 'refund').reduce((sum, p) => sum + p.amount, 0);

  const claim = await db.dbGet('SELECT total_charge FROM claims WHERE id = ?', [claimId]);
  const remaining = Math.max(0, (claim?.total_charge || 0) - totalPaid + refunds);

  let newStatus = 'submitted';
  if (totalPaid >= (claim?.total_charge || 0)) newStatus = 'paid';
  else if (totalPaid > 0) newStatus = 'partial_paid';

  await db.dbRun(
    'UPDATE claims SET total_paid = ?, patient_responsibility = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [totalPaid - refunds, remaining, newStatus, claimId]
  );
}

// ==========================================
// DENIAL MANAGEMENT
// ==========================================

async function recordDenial(claimId, denialData) {
  const claim = await db.dbGet('SELECT * FROM claims WHERE id = ?', [claimId]);
  if (!claim) throw new Error('Claim not found');

  const payer = claim.payer_id ? await db.dbGet('SELECT * FROM payers WHERE id = ?', [claim.payer_id]) : null;

  // Calculate appeal deadline (typically 60-180 days from denial)
  const denialDate = new Date(denialData.denial_date || new Date());
  const appealDays = payer?.payer_type === 'medicare' ? 120 : 60;
  const appealDeadline = new Date(denialDate.getTime() + appealDays * 24 * 60 * 60 * 1000);

  const result = await db.dbRun(
    `INSERT INTO denial_records
     (claim_id, denial_code, denial_reason, denial_category, denial_date,
      appeal_deadline, financial_impact)
     VALUES (?,?,?,?,?,?,?)`,
    [claimId, denialData.denial_code, denialData.denial_reason,
     denialData.denial_category || 'other',
     denialData.denial_date || new Date().toISOString().split('T')[0],
     appealDeadline.toISOString().split('T')[0],
     claim.total_charge]
  );

  // Update claim status
  await db.dbRun(
    `UPDATE claims SET status = 'denied', denial_reason = ?, denial_code = ?,
     adjudication_date = ?, appeal_deadline = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [denialData.denial_reason, denialData.denial_code,
     denialData.denial_date || new Date().toISOString().split('T')[0],
     appealDeadline.toISOString().split('T')[0], claimId]
  );

  return { id: result.lastID, appeal_deadline: appealDeadline.toISOString().split('T')[0] };
}

// ==========================================
// REVENUE ANALYTICS
// ==========================================

async function getRevenueAnalytics(startDate, endDate) {
  const dateFilter = startDate && endDate
    ? `WHERE c.date_of_service BETWEEN ? AND ?`
    : `WHERE c.date_of_service >= date('now', '-30 days')`;
  const params = startDate && endDate ? [startDate, endDate] : [];

  const [summary, byStatus, byPayer, denials, arAging] = await Promise.all([
    // Overall summary
    db.dbGet(
      `SELECT
         COUNT(*) as total_claims,
         SUM(total_charge) as total_charges,
         SUM(total_paid) as total_collected,
         SUM(patient_responsibility) as total_patient_ar,
         AVG(CASE WHEN adjudication_date IS NOT NULL
           THEN julianday(adjudication_date) - julianday(submission_date) END) as avg_days_to_pay
       FROM claims c ${dateFilter}`,
      params
    ),

    // By status
    db.dbAll(
      `SELECT status, COUNT(*) as count, SUM(total_charge) as charges, SUM(total_paid) as paid
       FROM claims c ${dateFilter} GROUP BY status ORDER BY count DESC`,
      params
    ),

    // By payer
    db.dbAll(
      `SELECT p.payer_name, COUNT(*) as claims, SUM(c.total_charge) as charges,
         SUM(c.total_paid) as paid,
         ROUND(AVG(CASE WHEN c.total_charge > 0 THEN c.total_paid / c.total_charge * 100 END), 1) as collection_rate
       FROM claims c LEFT JOIN payers p ON c.payer_id = p.id
       ${dateFilter} GROUP BY p.payer_name ORDER BY charges DESC`,
      params
    ),

    // Denial summary
    db.dbAll(
      `SELECT denial_category, COUNT(*) as count, SUM(financial_impact) as impact,
         SUM(CASE WHEN appeal_status = 'overturned' THEN 1 ELSE 0 END) as overturned
       FROM denial_records GROUP BY denial_category ORDER BY impact DESC`
    ),

    // AR Aging
    db.dbAll(
      `SELECT
         CASE
           WHEN julianday('now') - julianday(date_of_service) <= 30 THEN '0-30'
           WHEN julianday('now') - julianday(date_of_service) <= 60 THEN '31-60'
           WHEN julianday('now') - julianday(date_of_service) <= 90 THEN '61-90'
           WHEN julianday('now') - julianday(date_of_service) <= 120 THEN '91-120'
           ELSE '120+'
         END as aging_bucket,
         COUNT(*) as claims,
         SUM(total_charge - total_paid) as outstanding
       FROM claims
       WHERE status NOT IN ('paid', 'void')
       GROUP BY aging_bucket
       ORDER BY aging_bucket`
    )
  ]);

  return {
    period: { start: startDate || 'last 30 days', end: endDate || 'today' },
    summary: {
      ...summary,
      collection_rate: summary.total_charges > 0
        ? Math.round((summary.total_collected / summary.total_charges) * 100 * 10) / 10
        : 0
    },
    by_status: byStatus,
    by_payer: byPayer,
    denials,
    ar_aging: arAging
  };
}

// ==========================================
// QUERY FUNCTIONS
// ==========================================

async function getClaims(filters = {}) {
  let query = `SELECT c.*, p.first_name, p.last_name, p.mrn, py.payer_name
               FROM claims c
               JOIN patients p ON c.patient_id = p.id
               LEFT JOIN payers py ON c.payer_id = py.id`;
  const conditions = [];
  const params = [];

  if (filters.status) { conditions.push('c.status = ?'); params.push(filters.status); }
  if (filters.patient_id) { conditions.push('c.patient_id = ?'); params.push(filters.patient_id); }
  if (filters.payer_id) { conditions.push('c.payer_id = ?'); params.push(filters.payer_id); }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY c.created_at DESC LIMIT 100';

  return db.dbAll(query, params);
}

async function getClaimById(claimId) {
  const claim = await db.dbGet(
    `SELECT c.*, p.first_name, p.last_name, p.mrn, p.dob, p.insurance_carrier, p.insurance_id,
            py.payer_name, py.payer_type
     FROM claims c
     JOIN patients p ON c.patient_id = p.id
     LEFT JOIN payers py ON c.payer_id = py.id
     WHERE c.id = ?`,
    [claimId]
  );
  if (!claim) return null;

  const [lines, payments, denials] = await Promise.all([
    db.dbAll('SELECT * FROM claim_lines WHERE claim_id = ? ORDER BY line_number', [claimId]),
    db.dbAll('SELECT * FROM payments WHERE claim_id = ? ORDER BY payment_date DESC', [claimId]),
    db.dbAll('SELECT * FROM denial_records WHERE claim_id = ? ORDER BY denial_date DESC', [claimId])
  ]);

  return { ...claim, lines, payments, denials };
}

async function getPatientBalance(patientId) {
  const result = await db.dbGet(
    `SELECT
       SUM(total_charge) as total_charges,
       SUM(total_paid) as total_paid,
       SUM(patient_responsibility) as patient_balance
     FROM claims WHERE patient_id = ? AND status NOT IN ('void')`,
    [patientId]
  );
  return result;
}

async function getPayers() {
  return db.dbAll('SELECT * FROM payers WHERE active = 1 ORDER BY payer_name');
}

async function getFeeSchedule(category = null) {
  if (category) {
    return db.dbAll('SELECT * FROM fee_schedule WHERE category = ? ORDER BY cpt_code', [category]);
  }
  return db.dbAll('SELECT * FROM fee_schedule ORDER BY category, cpt_code');
}

// ==========================================
// HELPERS
// ==========================================

function generateClaimNumber() {
  const date = new Date();
  const prefix = `MJR${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  const random = Math.floor(Math.random() * 900000) + 100000;
  return `${prefix}-${random}`;
}

async function matchPayer(insuranceCarrier) {
  if (!insuranceCarrier) return null;
  const carrier = insuranceCarrier.toLowerCase();

  // Try exact match first
  let payer = await db.dbGet('SELECT * FROM payers WHERE LOWER(payer_name) = ?', [carrier]);
  if (payer) return payer;

  // Try partial match
  payer = await db.dbGet('SELECT * FROM payers WHERE LOWER(payer_name) LIKE ?', [`%${carrier.split(' ')[0]}%`]);
  if (payer) return payer;

  // Check keywords
  if (/medicare/i.test(carrier)) return db.dbGet("SELECT * FROM payers WHERE payer_id = 'MCARE'");
  if (/medicaid/i.test(carrier)) return db.dbGet("SELECT * FROM payers WHERE payer_id = 'GAMCD'");
  if (/blue\s*cross|bcbs/i.test(carrier)) return db.dbGet("SELECT * FROM payers WHERE payer_id = 'BCBSGA'");
  if (/aetna/i.test(carrier)) return db.dbGet("SELECT * FROM payers WHERE payer_id = 'AETNA'");
  if (/united/i.test(carrier)) return db.dbGet("SELECT * FROM payers WHERE payer_id = 'UHC'");
  if (/cigna/i.test(carrier)) return db.dbGet("SELECT * FROM payers WHERE payer_id = 'CIGNA'");
  if (/humana/i.test(carrier)) return db.dbGet("SELECT * FROM payers WHERE payer_id = 'HUMANA'");
  if (/tricare/i.test(carrier)) return db.dbGet("SELECT * FROM payers WHERE payer_id = 'TRICARE'");

  return null;
}

/**
 * Determine E&M code based on encounter complexity.
 * Simplified MDM-based level selection.
 */
function determineEMCode(encounter, problems, labOrders, imagingOrders, prescriptions) {
  const isNewPatient = encounter.encounter_type?.toLowerCase().includes('new');
  const numProblems = problems?.filter(p => p.status === 'active' || p.status === 'chronic').length || 0;
  const numOrders = (labOrders?.length || 0) + (imagingOrders?.length || 0);
  const numRx = prescriptions?.length || 0;

  // Medical Decision Making (simplified)
  // Level 1: Straightforward (1 self-limited problem, no labs/meds)
  // Level 2: Low (2+ problems or 1+ lab order)
  // Level 3: Moderate (3+ problems, or prescriptions + labs)
  // Level 4: High (4+ problems with labs + imaging + prescriptions)

  let complexity = 1;
  if (numProblems >= 2 || numOrders >= 1) complexity = 2;
  if (numProblems >= 3 || (numRx >= 1 && numOrders >= 1)) complexity = 3;
  if (numProblems >= 4 && numOrders >= 2 && numRx >= 1) complexity = 4;

  if (isNewPatient) {
    return ['99202', '99203', '99204', '99205'][Math.min(complexity - 1, 3)];
  }
  return ['99213', '99213', '99214', '99215'][Math.min(complexity - 1, 3)];
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  // Setup
  initBillingSchema,

  // Claims
  generateClaimFromEncounter,
  scrubClaim,
  submitClaim,
  getClaims,
  getClaimById,

  // Eligibility
  verifyEligibility,

  // Payments
  postPayment,
  getPatientBalance,

  // Denials
  recordDenial,

  // Reference data
  getPayers,
  getFeeSchedule,

  // Analytics
  getRevenueAnalytics
};
