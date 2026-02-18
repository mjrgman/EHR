import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client';

export function useCDS(encounterId, patientId, options = {}) {
  const { pollInterval = 5000, autoEvaluate = false } = options;
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!encounterId) return;
    try {
      const data = await api.getSuggestions(encounterId);
      setSuggestions(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [encounterId]);

  const evaluate = useCallback(async () => {
    if (!encounterId || !patientId) return;
    setLoading(true);
    try {
      const result = await api.evaluateCDS({ encounter_id: encounterId, patient_id: patientId });
      setSuggestions(result.suggestions || []);
      setError(null);
      return result;
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [encounterId, patientId]);

  const accept = useCallback(async (suggestionId) => {
    try {
      const result = await api.acceptSuggestion(suggestionId, {
        encounter_id: encounterId, patient_id: patientId
      });
      await refresh();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [encounterId, patientId, refresh]);

  const reject = useCallback(async (suggestionId, reason) => {
    try {
      await api.rejectSuggestion(suggestionId, { reason });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }, [refresh]);

  useEffect(() => {
    if (!encounterId || !pollInterval) return;
    refresh();
    intervalRef.current = setInterval(refresh, pollInterval);
    return () => clearInterval(intervalRef.current);
  }, [encounterId, pollInterval, refresh]);

  useEffect(() => {
    if (autoEvaluate && encounterId && patientId) evaluate();
  }, [autoEvaluate, encounterId, patientId, evaluate]);

  const pending = suggestions.filter(s => s.status === 'pending');
  const accepted = suggestions.filter(s => s.status === 'accepted');
  const rejected = suggestions.filter(s => s.status === 'rejected');

  return { suggestions, pending, accepted, rejected, loading, error, evaluate, accept, reject, refresh };
}
