/**
 * MediVault browser client — Phase 3c
 *
 * Thin wrapper around the `/api/medivault/export/:patientId` endpoint.
 * Triggers a browser download of a patient-owned FHIR R4 Bundle.
 *
 * Why this lives in its own module instead of src/api/client.js:
 *   The shared `request()` helper in client.js parses every response as
 *   JSON and returns the parsed object. An export response is a FHIR
 *   Bundle that we want to save to disk, not render — so we need raw
 *   fetch access to read the Blob and grab the Content-Disposition
 *   filename. Keeping this isolated avoids adding a binary-return
 *   branch to the shared helper.
 *
 * Audit: the server writes a vault_access_log row (see
 * server/routes/medivault-routes.js) AND the global audit-logger
 * middleware writes an audit_log row via the PHI_ROUTES entry added in
 * server/audit-logger.js. The client is not responsible for any
 * client-side audit — the server is authoritative.
 */

/**
 * Download the patient's MediVault export as a FHIR Bundle JSON file.
 *
 * @param {number|string} patientId
 * @returns {Promise<{filename: string, size: number}>} — resolves after
 *   the browser has been handed the download; does NOT wait for the user
 *   to choose a save location.
 * @throws {Error} on non-2xx response or network failure
 */
export async function exportPatient(patientId) {
  if (!patientId) {
    throw new Error('exportPatient: patientId is required');
  }

  // Reuse the same audit headers the rest of the app sends. If the
  // session isn't populated yet (first page load) these are simply
  // absent — the server tolerates that.
  const headers = { Accept: 'application/fhir+json' };
  if (typeof sessionStorage !== 'undefined') {
    const sid = sessionStorage.getItem('audit_session_id');
    if (sid) headers['X-Audit-Session-Id'] = sid;
  }

  const res = await fetch(`/api/medivault/export/${encodeURIComponent(patientId)}`, {
    method: 'GET',
    headers,
    credentials: 'same-origin'
  });

  if (!res.ok) {
    // Try to read a FHIR OperationOutcome for a useful message; fall
    // back to the raw text if the server returned something else.
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.issue?.[0]?.diagnostics || body?.error || JSON.stringify(body);
    } catch {
      try { detail = await res.text(); } catch { /* keep statusText */ }
    }
    const err = new Error(`MediVault export failed (${res.status}): ${detail}`);
    err.status = res.status;
    throw err;
  }

  // Parse filename from Content-Disposition: attachment; filename="medivault-<id>-<date>.json"
  // Fall back to a sane default if the header is absent (e.g. a proxy
  // stripped it) so the user still gets a usable file.
  const disposition = res.headers.get('content-disposition') || '';
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
  const filename = filenameMatch
    ? filenameMatch[1]
    : `medivault-${patientId}-${new Date().toISOString().slice(0, 10)}.json`;

  const blob = await res.blob();

  // Programmatic download via a transient anchor element — the standard
  // browser idiom that works in every modern browser without needing the
  // experimental File System Access API.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Small delay before revoking so Safari has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 100);

  return { filename, size: blob.size };
}

export default { exportPatient };
