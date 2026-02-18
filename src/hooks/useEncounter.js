import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

export function useEncounter(encounterId) {
  const [encounter, setEncounter] = useState(null);
  const [orders, setOrders] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!encounterId) return;
    setLoading(true);
    try {
      const [enc, ord] = await Promise.all([
        api.getEncounter(encounterId),
        api.getEncounterOrders(encounterId).catch(() => null)
      ]);
      setEncounter(enc);
      setOrders(ord);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [encounterId]);

  useEffect(() => { refresh(); }, [refresh]);

  const update = useCallback(async (data) => {
    if (!encounterId) return;
    try {
      const result = await api.updateEncounter(encounterId, data);
      await refresh();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [encounterId, refresh]);

  return { encounter, orders, loading, error, update, refresh };
}
