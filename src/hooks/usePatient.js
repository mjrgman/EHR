import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

export function usePatient(patientId) {
  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const data = await api.getPatient(patientId);
      setPatient(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { patient, loading, error, refresh };
}

export function usePatients() {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getPatients();
      setPatients(data);
    } catch (err) {
      console.error('Failed to load patients:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { patients, loading, refresh };
}
