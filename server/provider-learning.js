/**
 * MJR-EHR Provider Preference Learning
 * Tracks provider patterns and generates suggestions based on learned behavior.
 */

const db = require('./database');

/**
 * Record a provider action for learning.
 * Called whenever provider accepts a suggestion or manually creates an order.
 */
async function recordProviderAction(providerName, conditionCode, conditionName, actionType, actionDetail) {
  return db.upsertProviderPreference({
    provider_name: providerName,
    condition_code: conditionCode,
    condition_name: conditionName,
    action_type: actionType,
    action_detail: actionDetail
  });
}

/**
 * Get suggestions based on this provider's learned patterns.
 * Only returns preferences with confidence >= threshold.
 */
async function getSuggestionsFromPreferences(providerName, problems, confidenceThreshold = 0.7) {
  const suggestions = [];
  if (!problems || problems.length === 0) return suggestions;

  for (const problem of problems) {
    if (!problem.icd10_code) continue;

    const prefs = await db.getProviderPreferences(providerName, problem.icd10_code);
    const highConfidence = prefs.filter(p => p.confidence >= confidenceThreshold);

    for (const pref of highConfidence) {
      let detail;
      try {
        detail = typeof pref.action_detail === 'string' ? JSON.parse(pref.action_detail) : pref.action_detail;
      } catch {
        continue;
      }

      const typeMap = {
        'lab_order': 'lab_order',
        'medication': 'medication',
        'imaging': 'imaging_order',
        'referral': 'referral',
        'follow_up': 'preventive_care'
      };

      suggestions.push({
        suggestion_type: typeMap[pref.action_type] || 'lab_order',
        category: 'routine',
        priority: 55,
        title: `Your Usual: ${pref.condition_name}`,
        description: `Based on your practice pattern (${pref.frequency_count} times, ${Math.round(pref.confidence * 100)}% confidence).`,
        rationale: `Provider preference learned from ${pref.frequency_count} previous encounters.`,
        suggested_action: buildActionsFromPreference(pref, detail),
        source: 'provider_learning'
      });
    }
  }

  return suggestions;
}

function buildActionsFromPreference(pref, detail) {
  switch (pref.action_type) {
    case 'lab_order':
      if (detail.tests) {
        return detail.tests.map(t => ({
          type: 'create_lab_order',
          description: t.test_name,
          payload: { test_name: t.test_name, cpt_code: t.cpt_code, priority: 'routine' }
        }));
      }
      return [{ type: 'create_lab_order', description: detail.test_name || 'Lab order', payload: detail }];

    case 'medication':
      return [{ type: 'create_prescription', description: detail.medication_name || 'Medication', payload: detail }];

    case 'imaging':
      return [{ type: 'create_imaging_order', description: detail.study_type || 'Imaging', payload: detail }];

    case 'referral':
      return [{ type: 'create_referral', description: detail.specialty || 'Referral', payload: detail }];

    default:
      return [];
  }
}

/**
 * Decay unused preferences (run on startup or periodically).
 * Reduces confidence by 0.1 for preferences unused for 90+ days.
 */
async function decayPreferences() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString();

  await db.dbRun(
    `UPDATE provider_preferences SET confidence = MAX(0.1, confidence - 0.1)
     WHERE last_used < ? AND confidence > 0.1`,
    [cutoffStr]
  );
}

/**
 * Get all preferences for a provider (for display/management).
 */
async function getProviderProfile(providerName) {
  return db.getProviderPreferences(providerName);
}

module.exports = {
  recordProviderAction,
  getSuggestionsFromPreferences,
  decayPreferences,
  getProviderProfile
};
