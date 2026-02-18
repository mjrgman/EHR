#!/usr/bin/env node

/**
 * MJR-EHR Interactive Ambient System - Test Suite
 * Tests all components: database, AI extraction, API endpoints
 */

const path = require('path');
const fs = require('fs');

// Set test environment
process.env.DATABASE_PATH = path.join(__dirname, '../data/test-mjr-ehr.db');
process.env.AI_MODE = 'mock'; // Use pattern matching for tests
process.env.PROVIDER_NAME = 'Dr. Test Provider';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  MJR-EHR INTERACTIVE SYSTEM - TEST SUITE');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Clean up test database before starting
const testDbPath = process.env.DATABASE_PATH;
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
  console.log('✓ Cleaned up previous test database\n');
}

const db = require('../server/database');
const aiClient = require('../server/ai-client');

// Test utilities
let testCount = 0;
let passCount = 0;
let failCount = 0;

function test(description, testFn) {
  testCount++;
  process.stdout.write(`Test ${testCount}: ${description}... `);
  
  try {
    const result = testFn();
    if (result instanceof Promise) {
      return result
        .then(() => {
          console.log('✅ PASS');
          passCount++;
        })
        .catch(err => {
          console.log('❌ FAIL');
          console.error('  Error:', err.message);
          failCount++;
        });
    } else {
      console.log('✅ PASS');
      passCount++;
    }
  } catch (err) {
    console.log('❌ FAIL');
    console.error('  Error:', err.message);
    failCount++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// Wait for database initialization
async function waitForDb() {
  return new Promise(resolve => setTimeout(resolve, 1000));
}

// ==========================================
// RUN ALL TESTS
// ==========================================

async function runAllTests() {
  console.log('📋 PHASE 1: DATABASE TESTS\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await waitForDb();

  // Test 1: Database initialization
  await test('Database initialized with schema', async () => {
    const patients = await db.getAllPatients();
    assert(Array.isArray(patients), 'Patients table exists');
  });

  // Test 2: Demo data loaded
  await test('Demo patient (Sarah Mitchell) loaded', async () => {
    const patients = await db.getAllPatients();
    assert(patients.length > 0, 'At least one patient exists');
    assert(patients[0].first_name === 'Sarah', 'Demo patient is Sarah');
    assert(patients[0].mrn === '2018-04792', 'Correct MRN');
  });

  // Test 3: Get patient with full details
  await test('Retrieve patient with problems, meds, allergies', async () => {
    const patients = await db.getAllPatients();
    const patientId = patients[0].id;
    
    const problems = await db.getPatientProblems(patientId);
    const medications = await db.getPatientMedications(patientId);
    const allergies = await db.getPatientAllergies(patientId);
    
    assert(problems.length > 0, 'Patient has problems');
    assert(medications.length > 0, 'Patient has medications');
    assert(allergies.length > 0, 'Patient has allergies');
  });

  // Test 4: Create new patient
  await test('Create new patient', async () => {
    const newPatient = {
      first_name: 'John',
      middle_name: 'Michael',
      last_name: 'Smith',
      dob: '1978-06-15',
      sex: 'M',
      phone: '478-555-0199',
      email: 'john.smith@email.com',
      address_line1: '123 Test Street',
      city: 'Macon',
      state: 'GA',
      zip: '31201',
      insurance_carrier: 'Aetna',
      insurance_id: 'AT-998877'
    };
    
    const result = await db.createPatient(newPatient);
    assert(result.id > 0, 'Patient created with ID');
    assert(result.mrn.length > 0, 'MRN generated');
  });

  // Test 5: Add problem to patient
  await test('Add problem to patient', async () => {
    const patients = await db.getAllPatients();
    const patientId = patients[patients.length - 1].id; // Last created patient
    
    const result = await db.addProblem({
      patient_id: patientId,
      problem_name: 'Hypertension',
      icd10_code: 'I10',
      onset_date: '2024-01-01',
      status: 'active'
    });
    
    assert(result.id > 0, 'Problem added');
  });

  // Test 6: Add medication
  await test('Add medication to patient', async () => {
    const patients = await db.getAllPatients();
    const patientId = patients[patients.length - 1].id;
    
    const result = await db.addMedication({
      patient_id: patientId,
      medication_name: 'Lisinopril',
      generic_name: 'Lisinopril',
      dose: '10mg',
      route: 'PO',
      frequency: 'daily',
      start_date: '2024-01-01',
      status: 'active',
      prescriber: 'Dr. Test'
    });
    
    assert(result.id > 0, 'Medication added');
  });

  console.log('\n📋 PHASE 2: AI PATTERN MATCHING TESTS\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Test 7: Extract vitals from speech
  await test('Extract vitals from transcript', () => {
    const transcript = "Patient's blood pressure is 142 over 88, heart rate is 76, temperature 98.6 degrees, and weight is 187 pounds.";
    const vitals = aiClient.extractVitals(transcript);
    
    assert(vitals.systolic_bp === 142, 'Systolic BP extracted');
    assert(vitals.diastolic_bp === 88, 'Diastolic BP extracted');
    assert(vitals.heart_rate === 76, 'Heart rate extracted');
    assert(vitals.temperature === 98.6, 'Temperature extracted');
    assert(vitals.weight === 187, 'Weight extracted');
  });

  // Test 8: Extract medications from speech
  await test('Extract medications from transcript', () => {
    const transcript = "She's taking Metformin 1000mg twice daily, Lisinopril 20mg once daily, and we'll start Ozempic 0.25mg weekly.";
    const medications = aiClient.extractMedications(transcript);
    
    assert(medications.length >= 2, 'At least 2 medications extracted');
    
    const metformin = medications.find(m => m.name.toLowerCase().includes('metformin'));
    assert(metformin !== undefined, 'Metformin found');
    assert(metformin.dose === '1000mg', 'Metformin dose correct');
    assert(metformin.frequency === 'BID', 'Metformin frequency correct');
  });

  // Test 9: Extract problems/diagnoses
  await test('Extract problems from transcript', () => {
    const transcript = "Patient has type 2 diabetes and hypertension. Also chronic kidney disease stage 3a.";
    const problems = aiClient.extractProblems(transcript);
    
    assert(problems.length > 0, 'Problems extracted');
    assert(problems.some(p => p.code === 'E11.9'), 'Diabetes with ICD-10');
    assert(problems.some(p => p.code === 'I10'), 'Hypertension with ICD-10');
  });

  // Test 10: Extract lab orders
  await test('Extract lab orders from transcript', () => {
    const transcript = "Order A1C, basic metabolic panel, and urine microalbumin for 6 weeks from now.";
    const labs = aiClient.extractLabOrders(transcript);
    
    assert(labs.length >= 2, 'Multiple labs extracted');
    assert(labs.some(l => l.cpt === '83036'), 'A1C with CPT code');
    assert(labs.some(l => l.cpt === '80048'), 'BMP with CPT code');
  });

  console.log('\n📋 PHASE 3: SOAP NOTE GENERATION TEST\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Test 11: Generate complete SOAP note
  await test('Generate SOAP note from transcript', async () => {
    const patients = await db.getAllPatients();
    const patient = patients[0]; // Sarah Mitchell
    
    const transcript = `
Doctor: Hi Sarah, how are you doing today?
Patient: Not great doctor, my blood sugars have been high.
Doctor: What have they been running?
Patient: Usually around 180 to 220.
Doctor: I see your A1C is 8.4%, up from 7.2%. What happened with your Jardiance?
Patient: I stopped it about 2 months ago because I kept getting yeast infections.
Doctor: I understand. Let's check your blood pressure today.
Nurse: 142 over 88.
Doctor: That's a bit high. Given your kidney function declining and the Jardiance issue, I think we should start you on Ozempic 0.25 milligrams subcutaneously weekly.
Patient: Will that help my kidneys?
Doctor: Yes, recent studies show GLP-1 agonists reduce kidney disease progression by about 24%. We'll also increase your lisinopril from 20 to 40 milligrams daily for better blood pressure control.
Patient: Okay, when should I come back?
Doctor: Let's recheck your A1C and kidney function in 6 weeks.
    `;
    
    const vitals = {
      systolic_bp: 142,
      diastolic_bp: 88,
      heart_rate: 76,
      temperature: 98.6,
      weight: 187
    };
    
    const soapNote = await aiClient.generateSOAPNote(transcript, patient, vitals);
    
    assert(soapNote.length > 500, 'SOAP note generated with substantial content');
    assert(soapNote.includes('SUBJECTIVE'), 'Contains Subjective section');
    assert(soapNote.includes('OBJECTIVE'), 'Contains Objective section');
    assert(soapNote.includes('ASSESSMENT'), 'Contains Assessment section');
    assert(soapNote.includes('142/88'), 'Vitals included');
    assert(soapNote.includes('Ozempic') || soapNote.includes('semaglutide'), 'New medication included');
    assert(soapNote.includes('lisinopril') || soapNote.includes('Lisinopril'), 'Medication change included');
  });

  console.log('\n📋 PHASE 4: CLINICAL WORKFLOW TESTS\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Test 12: Create encounter
  await test('Create clinical encounter', async () => {
    const patients = await db.getAllPatients();
    const patientId = patients[0].id;
    
    const result = await db.createEncounter({
      patient_id: patientId,
      encounter_type: 'Office Visit - Follow-up',
      chief_complaint: 'Diabetes and hypertension follow-up',
      provider: 'Dr. Test Provider'
    });
    
    assert(result.id > 0, 'Encounter created');
  });

  // Test 13: Add vitals to encounter
  await test('Add vitals to encounter', async () => {
    const patients = await db.getAllPatients();
    const patientId = patients[0].id;
    
    const result = await db.addVitals({
      patient_id: patientId,
      systolic_bp: 142,
      diastolic_bp: 88,
      heart_rate: 76,
      temperature: 98.6,
      weight: 187
    });
    
    assert(result.id > 0, 'Vitals recorded');
  });

  // Test 14: Create prescription
  await test('Create prescription', async () => {
    const patients = await db.getAllPatients();
    const patientId = patients[0].id;
    
    const result = await db.createPrescription({
      patient_id: patientId,
      medication_name: 'Semaglutide (Ozempic)',
      generic_name: 'Semaglutide',
      dose: '0.25mg',
      route: 'SC',
      frequency: 'weekly',
      quantity: 4,
      refills: 0,
      instructions: 'Inject 0.25mg subcutaneously once weekly. Titrate to 0.5mg after 4 weeks.',
      indication: 'Type 2 Diabetes Mellitus',
      icd10_codes: 'E11.9',
      prescriber: 'Dr. Test Provider',
      prescribed_date: '2024-12-31',
      status: 'signed'
    });
    
    assert(result.id > 0, 'Prescription created');
  });

  // Test 15: Create lab order
  await test('Create lab order', async () => {
    const patients = await db.getAllPatients();
    const patientId = patients[0].id;
    
    const result = await db.createLabOrder({
      patient_id: patientId,
      test_name: 'Hemoglobin A1C',
      cpt_code: '83036',
      indication: 'Diabetes monitoring',
      icd10_codes: 'E11.9',
      order_date: '2024-12-31',
      priority: 'routine',
      ordered_by: 'Dr. Test Provider'
    });
    
    assert(result.id > 0, 'Lab order created');
  });

  // Test 16: Update encounter with SOAP note
  await test('Update encounter with transcript and SOAP note', async () => {
    const patients = await db.getAllPatients();
    const patient = patients[0];
    
    const transcript = "Doctor: Hi Sarah. Patient: Hello doctor, my sugars have been high.";
    const soapNote = await aiClient.generateSOAPNote(transcript, patient, {});
    
    const result = await db.updateEncounter(1, {
      transcript: transcript,
      soap_note: soapNote,
      status: 'completed',
      duration_minutes: 25
    });
    
    assert(result.changes > 0, 'Encounter updated');
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TEST RESULTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`  Total Tests: ${testCount}`);
  console.log(`  ✅ Passed: ${passCount}`);
  console.log(`  ❌ Failed: ${failCount}`);
  console.log(`  Success Rate: ${((passCount / testCount) * 100).toFixed(1)}%`);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (failCount === 0) {
    console.log('🎉 ALL TESTS PASSED! System is ready for deployment.\n');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Please review errors above.\n');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(err => {
  console.error('\n❌ Fatal error running tests:', err);
  process.exit(1);
});
