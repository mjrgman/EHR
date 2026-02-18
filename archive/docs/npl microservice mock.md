import os
import json
from flask import Flask, request, jsonify
from datetime import datetime, timedelta
import requests
import time
from concurrent.futures import ThreadPoolExecutor

# --- Configuration and Initialization ---

app = Flask(__name__)
# Allow CORS for front-end development (since this is a non-secure simulator)
from flask_cors import CORS
CORS(app) 

# Global Executor for concurrent API calls (for future scaling/responsiveness)
executor = ThreadPoolExecutor(max_workers=5)

# Initialize API Key (assuming it's provided in the execution environment)
# NOTE: In a real environment, this would be secured via environment variables or secret manager.
API_KEY = os.environ.get("GEMINI_API_KEY", "") 

# --- FHIR-like JSON Schema Definition ---
# This is the structured output we demand from the LLM, mimicking FHIR resources
# but simplified for the simulator.

NLP_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "conditions": {
            "type": "ARRAY",
            "description": "List of current and chronic conditions mentioned in the note, including the primary diagnosis.",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING", "description": "The name of the condition (e.g., Hypertension)."},
                    "code": {"type": "STRING", "description": "The corresponding ICD-10 code (e.g., I10)."}
                }
            }
        },
        "medication_requests": {
            "type": "ARRAY",
            "description": "List of medications mentioned for continuation or new prescription.",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING", "description": "Medication and dosage (e.g., Lisinopril 10mg PO daily)."},
                    "status": {"type": "STRING", "description": "Status of the request (e.g., active, on-hold, stopped)."}
                }
            }
        },
        "observations": {
            "type": "ARRAY",
            "description": "List of vital signs and key lab results mentioned in the objective section.",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "code": {"type": "STRING", "description": "LOINC code or a short descriptive code (e.g., 'BP', 'HR')."},
                    "value": {"type": "STRING", "description": "The recorded value (e.g., 140/90, 78)."},
                    "unit": {"type": "STRING", "description": "The unit of measure (e.g., mmHg, bpm)."}
                }
            }
        },
        "patient_summary": {
            "type": "STRING",
            "description": "A brief, plain-language summary of the visit suitable for the patient's portal, written at a 6th-grade reading level. Avoid clinical jargon."
        }
    }
}

# --- Utility Functions ---

def call_gemini_api(prompt, schema):
    """
    Calls the Gemini API with structured output configuration.
    Includes exponential backoff for resilience.
    """
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key={API_KEY}"
    
    system_instruction = (
        "You are an expert clinical Natural Language Processor. Your task is to analyze the "
        "raw physician's dictation and extract all clinical entities, converting them strictly "
        "into the requested JSON structure. If an ICD-10 code is not provided in the input, "
        "you must use your knowledge to provide the most likely code. Ensure the 'patient_summary' "
        "is simple and direct."
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "systemInstruction": {"parts": [{"text": system_instruction}]},
        "config": {
            "responseMimeType": "application/json",
            "responseSchema": schema
        }
    }
    
    max_retries = 3
    delay = 1

    for attempt in range(max_retries):
        try:
            response = requests.post(
                api_url, 
                headers={'Content-Type': 'application/json'}, 
                data=json.dumps(payload), 
                timeout=30
            )
            response.raise_for_status() # Raise exception for bad status codes (4xx or 5xx)

            result = response.json()
            # Extract the raw JSON string from the response
            json_text = result.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text')
            
            if json_text:
                return json.loads(json_text)
            else:
                print("Error: JSON text not found in Gemini response structure.")
                return {"error": "Failed to extract text from API response."}

        except requests.exceptions.RequestException as e:
            print(f"API call failed on attempt {attempt + 1}: {e}")
            if attempt < max_retries - 1:
                time.sleep(delay)
                delay *= 2
            else:
                return {"error": f"Gemini API request failed after {max_retries} attempts: {e}"}
        except json.JSONDecodeError as e:
            print(f"JSON Decode Error: {e} - Raw text: {json_text}")
            return {"error": "Failed to decode JSON from API response."}
            
    return {"error": "Failed to get a valid response from the Gemini API."}


def run_care_gap_analysis(structured_data):
    """
    Simulated Care Gap / Personalization Logic (Simple Rule-Based).
    In a real app, this would be a full ML model run.
    """
    recommendations = []
    conditions = [c['name'] for c in structured_data.get('conditions', [])]
    
    if 'Hypertension' in conditions:
        recommendations.append("REMINDER: Patient has Hypertension. Ensure lab orders for CMP are placed every 6 months to monitor kidney function.")
    
    if 'Type 2 Diabetes Mellitus' in conditions:
        recommendations.append("CARE GAP: A1C test required (last one over 90 days ago).")

    if 'Obesity' in conditions:
        recommendations.append("Personalization Suggestion: Offer referral to Nutritionist 'Dr. Jane Smith' (preferred by this provider).")
        
    return recommendations


# --- Flask Endpoints ---

@app.route('/process-note', methods=['POST'])
def process_note_endpoint():
    """
    Endpoint to receive raw dictation, call the NLP model, and run simulated logic.
    """
    data = request.json
    raw_dictation = data.get('raw_dictation')

    if not raw_dictation:
        return jsonify({"error": "Missing 'raw_dictation' in request."}), 400

    print(f"Processing dictation of length: {len(raw_dictation)}...")
    
    # 1. AI Invocation (NLP) - Calls Gemini for structured extraction
    structured_fhir_data = call_gemini_api(raw_dictation, NLP_RESPONSE_SCHEMA)

    if structured_fhir_data.get("error"):
        return jsonify({"error": "NLP Processing Failed", "details": structured_fhir_data["error"]}), 500

    # 2. AI Invocation (Predictive ML Mock) - Runs Care Gap Analysis
    recommendations = run_care_gap_analysis(structured_fhir_data)

    # 3. Compile Final Response
    response_data = {
        "structured_data": structured_fhir_data,
        "recommendations": recommendations,
        "processing_timestamp": datetime.now().isoformat()
    }

    return jsonify(response_data)


@app.route('/')
def home():
    """Simple status check for the service."""
    return "AI-Gen EHR NLP Microservice Mock is running."


# --- Execution ---

if __name__ == '__main__':
    # NOTE: The API_KEY must be set in your environment variables for the Gemini call to work.
    if not API_KEY:
        print("WARNING: GEMINI_API_KEY environment variable is not set. API calls will fail.")
        # Running the app anyway, but API endpoint will return an error.
    
    print("Starting Flask Mock Microservice on port 5000...")
    app.run(debug=True, port=5000, use_reloader=False)