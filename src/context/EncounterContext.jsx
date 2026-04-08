import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

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

  const value = useMemo(() => ({
    activeEncounter, activePatientId, startEncounter, clearEncounter, setActiveEncounter
  }), [activeEncounter, activePatientId, startEncounter, clearEncounter, setActiveEncounter]);

  return (
    <EncounterContext.Provider value={value}>
      {children}
    </EncounterContext.Provider>
  );
}

export function useEncounterContext() {
  const ctx = useContext(EncounterContext);
  if (!ctx) throw new Error('useEncounterContext must be used within EncounterProvider');
  return ctx;
}
