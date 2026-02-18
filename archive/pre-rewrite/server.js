const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const aiClient = require('./ai-client');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../dist')));

// ==========================================
// PATIENT ENDPOINTS
// ==========================================

// Get all patients
app.get('/api/patients', async (req, res) => {
  try {
    const patients = await db.getAllPatients();
    res.json(patients);
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// Get patient by ID with full details
app.get('/api/patients/:id', async (req, res) => {
  try {
    const patient = await db.getPatientById(req.params.id);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    // Get related data
    const [problems, medications, allergies] = await Promise.all([
      db.getPatientProblems(req.params.id),
      db.getPatientMedications(req.params.id),
      db.getPatientAllergies(req.params.id)
    ]);

    res.json({
      ...patient,
      age: db.calculateAge(patient.dob),
      problems,
      medications,
      allergies
    });
  } catch (error) {
    console.error('Error fetching patient:', error);
    res.status(500).json({ error: 'Failed to fetch patient' });
  }
});

// Create new patient from speech/form data
app.post('/api/patients', async (req, res) => {
  try {
    const result = await db.createPatient(req.body);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating patient:', error);
    res.status(500).json({ error: 'Failed to create patient' });
  }
});

// Extract patient data from speech transcript
app.post('/api/patients/extract-from-speech', async (req, res) => {
  try {
    const { transcript } = req.body;
    
    // Use AI to extract patient demographics
    const extracted = await aiClient.extractClinicalData(transcript, {});
    
    // Pattern matching for demographics
    const nameMatch = transcript.match(/(?:name is|patient|called)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i);
    const dobMatch = transcript.match(/(?:date of birth|DOB|born)\s+([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i);
    const phoneMatch = transcript.match(/(?:phone|number)\s+(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);
    const addressMatch = transcript.match(/(?:lives at|address)\s+(\d+\s+[A-Za-z\s]+)/i);
    const insuranceMatch = transcript.match(/(?:insurance|covered by)\s+([A-Za-z\s]+)(?:,|member)/i);

    const patientData = {
      first_name: nameMatch ? nameMatch[1] : '',
      last_name: nameMatch ? nameMatch[2] : '',
      dob: dobMatch ? new Date(dobMatch[1]).toISOString().split('T')[0] : null,
      phone: phoneMatch ? phoneMatch[1].replace(/[-.\s]/g, '') : '',
      address_line1: addressMatch ? addressMatch[1] : '',
      insurance_carrier: insuranceMatch ? insuranceMatch[1].trim() : ''
    };

    res.json({ extracted: patientData });
  } catch (error) {
    console.error('Error extracting patient data:', error);
    res.status(500).json({ error: 'Failed to extract patient data' });
  }
});

// ==========================================
// PROBLEM LIST ENDPOINTS
// ==========================================

// Add problem to patient
app.post('/api/patients/:id/problems', async (req, res) => {
  try {
    const problemData = {
      patient_id: req.params.id,
      ...req.body
    };
    const result = await db.addProblem(problemData);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error adding problem:', error);
    res.status(500).json({ error: 'Failed to add problem' });
  }
});

// ==========================================
// MEDICATION ENDPOINTS
// ==========================================

// Get patient medications
app.get('/api/patients/:id/medications', async (req, res) => {
  try {
    const medications = await db.getPatientMedications(req.params.id);
    res.json(medications);
  } catch (error) {
    console.error('Error fetching medications:', error);
    res.status(500).json({ error: 'Failed to fetch medications' });
  }
});

// Add medication
app.post('/api/patients/:id/medications', async (req, res) => {
  try {
    const medData = {
      patient_id: req.params.id,
      ...req.body
    };
    const result = await db.addMedication(medData);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error adding medication:', error);
    res.status(500).json({ error: 'Failed to add medication' });
  }
});

// ==========================================
// ENCOUNTER ENDPOINTS
// ==========================================

// Create new encounter
app.post('/api/encounters', async (req, res) => {
  try {
    const encounterData = {
      encounter_date: new Date().toISOString().split('T')[0],
      provider: process.env.PROVIDER_NAME || 'Dr. Provider',
      ...req.body
    };
    const result = await db.createEncounter(encounterData);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating encounter:', error);
    res.status(500).json({ error: 'Failed to create encounter' });
  }
});

// Update encounter with transcript/note
app.patch('/api/encounters/:id', async (req, res) => {
  try {
    const result = await db.updateEncounter(req.params.id, req.body);
    res.json(result);
  } catch (error) {
    console.error('Error updating encounter:', error);
    res.status(500).json({ error: 'Failed to update encounter' });
  }
});

// ==========================================
// AI/CLINICAL DATA ENDPOINTS
// ==========================================

// Extract clinical data from transcript in real-time
app.post('/api/ai/extract-data', async (req, res) => {
  try {
    const { transcript, patient_id } = req.body;
    
    // Get patient data
    const patient = await db.getPatientById(patient_id);
    
    // Extract clinical data
    const extracted = await aiClient.extractClinicalData(transcript, patient);
    
    res.json({
      mode: aiClient.getMode(),
      extracted
    });
  } catch (error) {
    console.error('Error extracting clinical data:', error);
    res.status(500).json({ error: 'Failed to extract clinical data' });
  }
});

// Generate SOAP note from transcript
app.post('/api/ai/generate-note', async (req, res) => {
  try {
    const { transcript, patient_id, vitals } = req.body;
    
    // Get patient data
    const patient = await db.getPatientById(patient_id);
    
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    // Generate SOAP note
    const soapNote = await aiClient.generateSOAPNote(transcript, patient, vitals);
    
    res.json({
      mode: aiClient.getMode(),
      soap_note: soapNote,
      claude_enabled: aiClient.isClaudeEnabled()
    });
  } catch (error) {
    console.error('Error generating SOAP note:', error);
    res.status(500).json({ error: 'Failed to generate SOAP note' });
  }
});

// ==========================================
// PRESCRIPTION ENDPOINTS
// ==========================================

// Create prescription
app.post('/api/prescriptions', async (req, res) => {
  try {
    const rxData = {
      prescribed_date: new Date().toISOString().split('T')[0],
      prescriber: process.env.PROVIDER_NAME || 'Dr. Provider',
      status: 'signed', // Demo mode - mark as signed
      ...req.body
    };
    
    const result = await db.createPrescription(rxData);
    
    // Also add to medications list if new
    if (req.body.add_to_medications) {
      await db.addMedication({
        patient_id: req.body.patient_id,
        medication_name: req.body.medication_name,
        generic_name: req.body.generic_name,
        dose: req.body.dose,
        route: req.body.route,
        frequency: req.body.frequency,
        start_date: rxData.prescribed_date,
        status: 'active',
        prescriber: rxData.prescriber
      });
    }
    
    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating prescription:', error);
    res.status(500).json({ error: 'Failed to create prescription' });
  }
});

// Generate prescription from speech
app.post('/api/prescriptions/from-speech', async (req, res) => {
  try {
    const { transcript, patient_id, encounter_id } = req.body;
    
    // Extract medication orders from transcript
    const medications = aiClient.extractMedications(transcript);
    
    const prescriptions = [];
    
    for (const med of medications) {
      // Check if this is a "start" or new medication
      const isNew = transcript.toLowerCase().includes('start') && 
                    transcript.toLowerCase().includes(med.name.toLowerCase());
      
      if (isNew) {
        // Create prescription
        const rxData = {
          patient_id,
          encounter_id,
          medication_name: med.name,
          generic_name: med.name, // Would need drug database for accurate generic
          dose: med.dose,
          route: med.route,
          frequency: med.frequency,
          quantity: med.frequency === 'weekly' ? 4 : 30, // Default quantities
          refills: 0,
          instructions: `Take ${med.dose} ${med.route} ${med.frequency}`,
          prescriber: process.env.PROVIDER_NAME || 'Dr. Provider',
          prescribed_date: new Date().toISOString().split('T')[0],
          status: 'signed'
        };
        
        const result = await db.createPrescription(rxData);
        prescriptions.push({ ...rxData, id: result.id });
      }
    }
    
    res.json({ prescriptions });
  } catch (error) {
    console.error('Error generating prescriptions:', error);
    res.status(500).json({ error: 'Failed to generate prescriptions' });
  }
});

// ==========================================
// LAB ORDER ENDPOINTS
// ==========================================

// Create lab order
app.post('/api/lab-orders', async (req, res) => {
  try {
    const orderData = {
      order_date: new Date().toISOString().split('T')[0],
      ordered_by: process.env.PROVIDER_NAME || 'Dr. Provider',
      status: 'ordered',
      ...req.body
    };
    
    const result = await db.createLabOrder(orderData);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating lab order:', error);
    res.status(500).json({ error: 'Failed to create lab order' });
  }
});

// Generate lab orders from speech
app.post('/api/lab-orders/from-speech', async (req, res) => {
  try {
    const { transcript, patient_id, encounter_id } = req.body;
    
    // Extract lab orders from transcript
    const labs = aiClient.extractLabOrders(transcript);
    
    const orders = [];
    
    // Parse scheduled date if mentioned
    let scheduledDate = null;
    const dateMatch = transcript.match(/(\d+)\s+weeks?/i);
    if (dateMatch) {
      const weeksFromNow = parseInt(dateMatch[1]);
      scheduledDate = new Date();
      scheduledDate.setDate(scheduledDate.getDate() + (weeksFromNow * 7));
      scheduledDate = scheduledDate.toISOString().split('T')[0];
    }
    
    for (const lab of labs) {
      const orderData = {
        patient_id,
        encounter_id,
        test_name: lab.name,
        cpt_code: lab.cpt,
        order_date: new Date().toISOString().split('T')[0],
        scheduled_date: scheduledDate,
        priority: 'routine',
        ordered_by: process.env.PROVIDER_NAME || 'Dr. Provider'
      };
      
      const result = await db.createLabOrder(orderData);
      orders.push({ ...orderData, id: result.id });
    }
    
    res.json({ orders });
  } catch (error) {
    console.error('Error generating lab orders:', error);
    res.status(500).json({ error: 'Failed to generate lab orders' });
  }
});

// ==========================================
// VITALS ENDPOINTS
// ==========================================

// Add vitals
app.post('/api/vitals', async (req, res) => {
  try {
    const vitalsData = {
      recorded_by: process.env.PROVIDER_NAME || 'MA',
      ...req.body
    };
    const result = await db.addVitals(vitalsData);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error adding vitals:', error);
    res.status(500).json({ error: 'Failed to add vitals' });
  }
});

// Extract vitals from speech
app.post('/api/vitals/from-speech', async (req, res) => {
  try {
    const { transcript, patient_id, encounter_id } = req.body;
    
    // Extract vitals from transcript
    const vitals = aiClient.extractVitals(transcript);
    
    if (Object.keys(vitals).length > 0) {
      vitals.patient_id = patient_id;
      if (encounter_id) vitals.encounter_id = encounter_id;
      
      const result = await db.addVitals(vitals);
      res.json({ ...vitals, id: result.id });
    } else {
      res.json({ message: 'No vitals found in transcript' });
    }
  } catch (error) {
    console.error('Error extracting vitals:', error);
    res.status(500).json({ error: 'Failed to extract vitals' });
  }
});

// ==========================================
// SYSTEM ENDPOINTS
// ==========================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    ai_mode: aiClient.getMode(),
    claude_enabled: aiClient.isClaudeEnabled(),
    timestamp: new Date().toISOString()
  });
});

// Get AI configuration status
app.get('/api/ai/status', (req, res) => {
  res.json({
    mode: aiClient.getMode(),
    claude_enabled: aiClient.isClaudeEnabled(),
    features: {
      pattern_matching: true,
      claude_api: aiClient.isClaudeEnabled(),
      real_time_extraction: true,
      soap_generation: true
    }
  });
});

// ==========================================
// SERVE REACT APP
// ==========================================

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MJR-EHR Interactive Ambient System
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  🚀 Server running on: http://localhost:${PORT}
  🧠 AI Mode: ${aiClient.getMode()}
  ${aiClient.isClaudeEnabled() ? '✅ Claude API: Enabled' : '📝 Claude API: Disabled (using pattern matching)'}
  
  📊 Database: Connected
  🎤 Speech Recognition: Ready (browser-based)
  
  Ready for interactive demos!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
});

module.exports = app;
