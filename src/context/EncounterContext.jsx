import React, { createContext, useContext, useState, useCallback } from 'react';

const EncounterContext = createContext(null);

export function EncounterProvider({ children }) {
  const [activeEncounter, setActiveEncounter] = useState(null);
  const [activePatientId, setActivePatientId] = useState(null);

  const startEncounter = useCallback((encounter, patientId) => {
    setActiveEncounter(encounter);
    setActivePatientId(patientId);
  }, []);

  const clearEncounter = useCallback(() => {
    setActiveEncounter(null);
    setActivePatientId(null);
  }, []);

  return (
    <EncounterContext.Provider value={{ activeEncounter, activePatientId, startEncounter, clearEncounter, setActiveEncounter }}>
      {children}
    </EncounterContext.Provider>
  );
}

export function useEncounterContext() {
  const ctx = useContext(EncounterContext);
  if (!ctx) throw new Error('useEncounterContext must be used within EncounterProvider');
  return ctx;
}
