const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../data/mjr-ehr.db');
const DATA_DIR = path.dirname(DB_PATH);

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database at:', DB_PATH);
  }
});

// Initialize database schema
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Patients table
      db.run(`
        CREATE TABLE IF NOT EXISTS patients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mrn TEXT UNIQUE NOT NULL,
          first_name TEXT NOT NULL,
          middle_name TEXT,
          last_name TEXT NOT NULL,
          dob DATE NOT NULL,
          sex TEXT CHECK(sex IN ('M', 'F', 'Other')),
          phone TEXT,
          email TEXT,
          address_line1 TEXT,
          address_line2 TEXT,
          city TEXT,
          state TEXT,
          zip TEXT,
          insurance_carrier TEXT,
          insurance_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Problems/Diagnoses table
      db.run(`
        CREATE TABLE IF NOT EXISTS problems (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          patient_id INTEGER NOT NULL,
          problem_name TEXT NOT NULL,
          icd10_code TEXT,
          onset_date DATE,
          resolved_date DATE,
          status TEXT CHECK(status IN ('active', 'resolved', 'chronic')) DEFAULT 'active',
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
        )
      `);

      // Medications table (current + historical)
      db.run(`
        CREATE TABLE IF NOT EXISTS medications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          patient_id INTEGER NOT NULL,
          medication_name TEXT NOT NULL,
          generic_name TEXT,
          dose TEXT,
          route TEXT,
          frequency TEXT,
          start_date DATE,
          end_date DATE,
          discontinued_reason TEXT,
          status TEXT CHECK(status IN ('active', 'discontinued', 'completed')) DEFAULT 'active',
          prescriber TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
        )
      `);

      // Allergies table
      db.run(`
        CREATE TABLE IF NOT EXISTS allergies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          patient_id INTEGER NOT NULL,
          allergen TEXT NOT NULL,
          reaction TEXT,
          severity TEXT CHECK(severity IN ('mild', 'moderate', 'severe')),
          onset_date DATE,
          verified BOOLEAN DEFAULT 1,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
        )
      `);

      // Encounters table
      db.run(`
        CREATE TABLE IF NOT EXISTS encounters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          patient_id INTEGER NOT NULL,
          encounter_date DATE NOT NULL,
          encounter_type TEXT,
          chief_complaint TEXT,
          transcript TEXT,
          soap_note TEXT,
          status TEXT CHECK(status IN ('in-progress', 'completed', 'signed')) DEFAULT 'in-progress',
          provider TEXT,
          duration_minutes INTEGER,
          completed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
        )
      `);

      // Vitals table
      db.run(`
        CREATE TABLE IF NOT EXISTS vitals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          patient_id INTEGER NOT NULL,
          encounter_id INTEGER,
          recorded_date DATETIME NOT NULL,
          systolic_bp INTEGER,
          diastolic_bp INTEGER,
          heart_rate INTEGER,
          respiratory_rate INTEGER,
          temperature REAL,
          weight REAL,
          height REAL,
          bmi REAL,
          spo2 INTEGER,
          recorded_by TEXT,
          FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
          FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
        )
      `);

      // Labs table
      db.run(`
        CREATE TABLE IF NOT EXISTS labs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          patient_id INTEGER NOT NULL,
          test_name TEXT NOT NULL,
          result_value TEXT,
          reference_range TEXT,
          units TEXT,
          result_date DATE,
          status TEXT CHECK(status IN ('pending', 'resulted', 'final')) DEFAULT 'pending',
          abnormal_flag TEXT,
          notes TEXT,
          FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
        )
      `);

      // Prescriptions table
      db.run(`
        CREATE TABLE IF NOT EXISTS prescriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          patient_id INTEGER NOT NULL,
          encounter_id INTEGER,
          medication_name TEXT NOT NULL,
          generic_name TEXT,
          dose TEXT NOT NULL,
          route TEXT NOT NULL,
          frequency TEXT NOT NULL,
          quantity INTEGER,
          refills INTEGER DEFAULT 0,
          instructions TEXT,
          indication TEXT,
          icd10_codes TEXT,
          prescriber TEXT NOT NULL,
          prescribed_date DATE NOT NULL,
          status TEXT CHECK(status IN ('draft', 'signed', 'transmitted', 'dispensed')) DEFAULT 'draft',
          pdf_path TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
          FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
        )
      `);

      // Lab Orders table
      db.run(`
        CREATE TABLE IF NOT EXISTS lab_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          patient_id INTEGER NOT NULL,
          encounter_id INTEGER,
          test_name TEXT NOT NULL,
          cpt_code TEXT,
          indication TEXT,
          icd10_codes TEXT,
          order_date DATE NOT NULL,
          scheduled_date DATE,
          status TEXT CHECK(status IN ('ordered', 'scheduled', 'completed', 'cancelled')) DEFAULT 'ordered',
          priority TEXT CHECK(priority IN ('routine', 'urgent', 'stat')) DEFAULT 'routine',
          fasting_required BOOLEAN DEFAULT 0,
          special_instructions TEXT,
          ordered_by TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
          FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
        )
      `, (err) => {
        if (err) reject(err);
        else {
          console.log('✅ Database schema initialized');
          resolve();
        }
      });
    });
  });
}

// Helper function to generate MRN
function generateMRN() {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 90000) + 10000;
  return `${year}-${random}`;
}

// Helper function to calculate age from DOB
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

// Load demo patient data
function loadDemoData() {
  return new Promise((resolve, reject) => {
    // Check if demo patient already exists
    db.get('SELECT COUNT(*) as count FROM patients', (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      
      if (row.count > 0) {
        console.log('✅ Demo data already loaded');
        resolve();
        return;
      }

      console.log('📝 Loading demo patient data...');

      // Insert Sarah Mitchell - Diabetes/CKD patient
      db.run(`
        INSERT INTO patients (mrn, first_name, middle_name, last_name, dob, sex, phone, email, 
                             address_line1, city, state, zip, insurance_carrier, insurance_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, ['2018-04792', 'Sarah', 'Ann', 'Mitchell', '1963-01-15', 'F', '478-555-0147', 
          'sarah.mitchell@email.com', '456 Oak Street', 'Macon', 'GA', '31201',
          'Blue Cross Blue Shield of Georgia', 'GX-334521'], function(err) {
        if (err) {
          reject(err);
          return;
        }

        const patientId = this.lastID;

        // Add problems
        const problems = [
          ['Type 2 Diabetes Mellitus', 'E11.9', '2018-03-15', null, 'chronic'],
          ['Chronic Kidney Disease Stage 3a', 'N18.3', '2023-06-20', null, 'chronic'],
          ['Hypertension', 'I10', '2017-11-10', null, 'chronic'],
          ['Obesity', 'E66.9', '2015-05-01', null, 'chronic']
        ];

        problems.forEach(([name, code, onset, resolved, status]) => {
          db.run(`
            INSERT INTO problems (patient_id, problem_name, icd10_code, onset_date, resolved_date, status)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [patientId, name, code, onset, resolved, status]);
        });

        // Add current medications
        const medications = [
          ['Metformin', 'Metformin', '1000mg', 'PO', 'BID', '2018-03-15', null, null, 'active', 'Dr. Johnson'],
          ['Lisinopril', 'Lisinopril', '20mg', 'PO', 'daily', '2017-11-10', null, null, 'active', 'Dr. Johnson'],
          ['Atorvastatin', 'Atorvastatin', '20mg', 'PO', 'qHS', '2018-03-15', null, null, 'active', 'Dr. Johnson'],
          ['Jardiance', 'Empagliflozin', '10mg', 'PO', 'daily', '2022-01-10', '2024-10-01', 'Recurrent vulvovaginal candidiasis', 'discontinued', 'Dr. Johnson']
        ];

        medications.forEach(([brand, generic, dose, route, freq, start, end, reason, status, prescriber]) => {
          db.run(`
            INSERT INTO medications (patient_id, medication_name, generic_name, dose, route, frequency, 
                                    start_date, end_date, discontinued_reason, status, prescriber)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [patientId, brand, generic, dose, route, freq, start, end, reason, status, prescriber]);
        });

        // Add allergies
        db.run(`
          INSERT INTO allergies (patient_id, allergen, reaction, severity, verified)
          VALUES (?, ?, ?, ?, ?)
        `, [patientId, 'Penicillin', 'Hives', 'moderate', 1]);

        // Add recent labs
        const labs = [
          ['Hemoglobin A1C', '8.4', '< 7.0', '%', '2024-11-15', 'final', 'High'],
          ['Creatinine', '1.3', '0.6-1.2', 'mg/dL', '2024-11-15', 'final', 'High'],
          ['eGFR', '52', '> 60', 'mL/min/1.73m²', '2024-11-15', 'final', 'Low'],
          ['Urine Microalbumin', '45', '< 30', 'mg/g', '2024-11-15', 'final', 'High']
        ];

        labs.forEach(([test, value, range, units, date, status, flag]) => {
          db.run(`
            INSERT INTO labs (patient_id, test_name, result_value, reference_range, units, 
                             result_date, status, abnormal_flag)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [patientId, test, value, range, units, date, status, flag]);
        });

        console.log('✅ Demo patient Sarah Mitchell loaded');
        resolve();
      });
    });
  });
}

// Database query helpers
const db_helpers = {
  // Get all patients
  getAllPatients: () => {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM patients ORDER BY last_name, first_name', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  // Get patient by ID
  getPatientById: (id) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM patients WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  // Create new patient
  createPatient: (patientData) => {
    return new Promise((resolve, reject) => {
      const mrn = generateMRN();
      const { first_name, middle_name, last_name, dob, sex, phone, email,
              address_line1, address_line2, city, state, zip, 
              insurance_carrier, insurance_id } = patientData;

      db.run(`
        INSERT INTO patients (mrn, first_name, middle_name, last_name, dob, sex, phone, email,
                             address_line1, address_line2, city, state, zip, 
                             insurance_carrier, insurance_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [mrn, first_name, middle_name, last_name, dob, sex, phone, email,
          address_line1, address_line2, city, state, zip,
          insurance_carrier, insurance_id], function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, mrn });
      });
    });
  },

  // Get patient's problems
  getPatientProblems: (patientId) => {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT * FROM problems 
        WHERE patient_id = ? 
        ORDER BY status DESC, onset_date DESC
      `, [patientId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  // Add problem to patient
  addProblem: (problemData) => {
    return new Promise((resolve, reject) => {
      const { patient_id, problem_name, icd10_code, onset_date, status, notes } = problemData;
      db.run(`
        INSERT INTO problems (patient_id, problem_name, icd10_code, onset_date, status, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [patient_id, problem_name, icd10_code, onset_date, status || 'active', notes], function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      });
    });
  },

  // Get patient's medications
  getPatientMedications: (patientId) => {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT * FROM medications 
        WHERE patient_id = ? 
        ORDER BY status, medication_name
      `, [patientId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  // Add medication
  addMedication: (medData) => {
    return new Promise((resolve, reject) => {
      const { patient_id, medication_name, generic_name, dose, route, frequency,
              start_date, status, prescriber } = medData;
      db.run(`
        INSERT INTO medications (patient_id, medication_name, generic_name, dose, route, 
                                frequency, start_date, status, prescriber)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [patient_id, medication_name, generic_name, dose, route, frequency,
          start_date, status || 'active', prescriber], function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      });
    });
  },

  // Get patient's allergies
  getPatientAllergies: (patientId) => {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM allergies WHERE patient_id = ?', [patientId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  // Create prescription
  createPrescription: (rxData) => {
    return new Promise((resolve, reject) => {
      const { patient_id, encounter_id, medication_name, generic_name, dose, route, 
              frequency, quantity, refills, instructions, indication, icd10_codes, 
              prescriber, prescribed_date, status } = rxData;
      
      db.run(`
        INSERT INTO prescriptions (patient_id, encounter_id, medication_name, generic_name,
                                  dose, route, frequency, quantity, refills, instructions,
                                  indication, icd10_codes, prescriber, prescribed_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [patient_id, encounter_id, medication_name, generic_name, dose, route, frequency,
          quantity, refills, instructions, indication, icd10_codes, prescriber, 
          prescribed_date, status || 'draft'], function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      });
    });
  },

  // Create lab order
  createLabOrder: (orderData) => {
    return new Promise((resolve, reject) => {
      const { patient_id, encounter_id, test_name, cpt_code, indication, icd10_codes,
              order_date, scheduled_date, priority, fasting_required, 
              special_instructions, ordered_by } = orderData;
      
      db.run(`
        INSERT INTO lab_orders (patient_id, encounter_id, test_name, cpt_code, indication,
                               icd10_codes, order_date, scheduled_date, priority,
                               fasting_required, special_instructions, ordered_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [patient_id, encounter_id, test_name, cpt_code, indication, icd10_codes,
          order_date, scheduled_date, priority || 'routine', fasting_required || 0,
          special_instructions, ordered_by], function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      });
    });
  },

  // Create encounter
  createEncounter: (encounterData) => {
    return new Promise((resolve, reject) => {
      const { patient_id, encounter_date, encounter_type, chief_complaint, provider } = encounterData;
      const finalDate = encounter_date || new Date().toISOString().split('T')[0];
      
      db.run(`
        INSERT INTO encounters (patient_id, encounter_date, encounter_type, chief_complaint, provider)
        VALUES (?, ?, ?, ?, ?)
      `, [patient_id, finalDate, encounter_type, chief_complaint, provider], function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      });
    });
  },

  // Update encounter with transcript and note
  updateEncounter: (encounterId, updates) => {
    return new Promise((resolve, reject) => {
      const { transcript, soap_note, status, duration_minutes } = updates;
      db.run(`
        UPDATE encounters 
        SET transcript = COALESCE(?, transcript),
            soap_note = COALESCE(?, soap_note),
            status = COALESCE(?, status),
            duration_minutes = COALESCE(?, duration_minutes),
            completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
        WHERE id = ?
      `, [transcript, soap_note, status, duration_minutes, status, encounterId], function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
  },

  // Add vitals
  addVitals: (vitalsData) => {
    return new Promise((resolve, reject) => {
      const { patient_id, encounter_id, systolic_bp, diastolic_bp, heart_rate,
              respiratory_rate, temperature, weight, height, spo2, recorded_by } = vitalsData;
      
      const bmi = height && weight ? (weight / (height * height) * 703).toFixed(1) : null;
      const recorded_date = new Date().toISOString();

      db.run(`
        INSERT INTO vitals (patient_id, encounter_id, recorded_date, systolic_bp, diastolic_bp,
                           heart_rate, respiratory_rate, temperature, weight, height, bmi, 
                           spo2, recorded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [patient_id, encounter_id, recorded_date, systolic_bp, diastolic_bp, heart_rate,
          respiratory_rate, temperature, weight, height, bmi, spo2, recorded_by], function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      });
    });
  }
};

// Initialize database on module load
initializeDatabase()
  .then(() => loadDemoData())
  .catch(err => console.error('Database initialization error:', err));

module.exports = {
  db,
  ...db_helpers,
  generateMRN,
  calculateAge
};
