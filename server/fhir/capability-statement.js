'use strict';

/**
 * FHIR R4 CapabilityStatement
 * Describes the server's FHIR capabilities at GET /fhir/R4/metadata
 * Spec: https://hl7.org/fhir/R4/capabilitystatement.html
 */

function buildCapabilityStatement(baseUrl) {
  return {
    resourceType: 'CapabilityStatement',
    id: 'agentic-ehr',
    url: `${baseUrl}/fhir/R4/metadata`,
    version: '1.0.0',
    name: 'AgenticEHR_FHIR_Server',
    title: 'Agentic EHR FHIR R4 Server',
    status: 'active',
    experimental: true,
    date: new Date().toISOString().split('T')[0],
    publisher: 'ImpactMed Consulting, LLC',
    description: 'FHIR R4 read-only translation layer for the Agentic EHR system. Exposes internal clinical data as FHIR resources.',
    kind: 'instance',
    software: {
      name: 'Agentic EHR',
      version: '2.0.0'
    },
    fhirVersion: '4.0.1',
    format: ['json'],
    rest: [{
      mode: 'server',
      documentation: 'FHIR R4 server with SMART-on-FHIR app launch support. Read facade + inbound Bundle ingestion.',
      security: {
        cors: true,
        service: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/restful-security-service',
            code: 'SMART-on-FHIR',
            display: 'SMART-on-FHIR'
          }]
        }],
        extension: [{
          url: 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris',
          extension: [
            { url: 'authorize', valueUri: `${baseUrl}/smart/authorize` },
            { url: 'token',     valueUri: `${baseUrl}/smart/token` },
            { url: 'introspect', valueUri: `${baseUrl}/smart/introspect` },
          ]
        }]
      },
      resource: [
        resourceEntry('Patient', ['read', 'search-type'], [
          searchParam('_id', 'token', 'Logical ID'),
          searchParam('identifier', 'token', 'MRN or insurance ID')
        ]),
        resourceEntry('Encounter', ['read', 'search-type'], [
          searchParam('patient', 'reference', 'Patient ID')
        ]),
        resourceEntry('Condition', ['search-type'], [
          searchParam('patient', 'reference', 'Patient ID')
        ]),
        resourceEntry('Observation', ['search-type'], [
          searchParam('patient', 'reference', 'Patient ID'),
          searchParam('category', 'token', 'vital-signs | laboratory')
        ]),
        resourceEntry('AllergyIntolerance', ['search-type'], [
          searchParam('patient', 'reference', 'Patient ID')
        ]),
        resourceEntry('MedicationRequest', ['search-type'], [
          searchParam('patient', 'reference', 'Patient ID')
        ]),
        resourceEntry('Appointment', ['search-type'], [
          searchParam('patient', 'reference', 'Patient ID')
        ]),
        resourceEntry('Practitioner', ['read'], [
          searchParam('_id', 'token', 'Logical ID')
        ]),
        resourceEntry('Bundle', ['create'], [])
      ]
    }]
  };
}

function resourceEntry(type, interactions, searchParams) {
  return {
    type,
    interaction: interactions.map(code => ({ code })),
    searchParam: searchParams
  };
}

function searchParam(name, type, documentation) {
  return { name, type, documentation };
}

module.exports = { buildCapabilityStatement };
