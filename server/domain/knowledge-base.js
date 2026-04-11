/**
 * Knowledge Base Loader for Domain Logic Engine
 *
 * Loads and validates the rule files, then exposes them through a single
 * query API used by the functional-med-engine.
 *
 * SAFETY CONTRACT (enforced at load time):
 *   - Every rule MUST have a non-empty `evidence_source`.
 *   - Every rule MUST have a unique `id`.
 *   - Any rule with `requiresDosingApproval: true` in its actions MUST
 *     also have `medication` and `proposedDose` in that action's payload.
 *
 * If any rule fails validation, the loader throws — the agent won't start
 * with a broken knowledge base.
 */

const { HRT_RULES } = require('./rules/hrt-rules');
const { PEPTIDE_RULES } = require('./rules/peptide-rules');
const { FUNCTIONAL_MED_RULES } = require('./rules/functional-med-rules');

let cachedRules = null;

/**
 * Validate a single rule. Throws on any violation.
 */
function validateRule(rule, sourceFile) {
  if (!rule.id) {
    throw new Error(`[KnowledgeBase] Rule in ${sourceFile} missing required field: id`);
  }
  if (!rule.rule_name) {
    throw new Error(`[KnowledgeBase] Rule ${rule.id} missing required field: rule_name`);
  }
  if (!rule.rule_type) {
    throw new Error(`[KnowledgeBase] Rule ${rule.id} missing required field: rule_type`);
  }
  if (!rule.category) {
    throw new Error(`[KnowledgeBase] Rule ${rule.id} missing required field: category`);
  }
  if (!rule.trigger_condition) {
    throw new Error(`[KnowledgeBase] Rule ${rule.id} missing required field: trigger_condition`);
  }
  if (!rule.suggested_actions) {
    throw new Error(`[KnowledgeBase] Rule ${rule.id} missing required field: suggested_actions`);
  }

  // SAFETY: Evidence source is mandatory
  if (!rule.evidence_source || typeof rule.evidence_source !== 'string' || rule.evidence_source.trim().length === 0) {
    throw new Error(
      `[KnowledgeBase] Rule ${rule.id} has empty evidence_source — every clinical rule must cite an evidence source`
    );
  }

  // SAFETY: Dosing actions must have medication + proposedDose
  const actions = rule.suggested_actions.actions || [];
  for (const action of actions) {
    if (action.requiresDosingApproval) {
      if (!action.payload) {
        throw new Error(
          `[KnowledgeBase] Rule ${rule.id} has requiresDosingApproval action without payload`
        );
      }
      if (!action.payload.medication) {
        throw new Error(
          `[KnowledgeBase] Rule ${rule.id} has requiresDosingApproval action missing medication`
        );
      }
      if (!action.payload.proposedDose) {
        throw new Error(
          `[KnowledgeBase] Rule ${rule.id} has requiresDosingApproval action missing proposedDose`
        );
      }
      if (!action.payload.rationale) {
        throw new Error(
          `[KnowledgeBase] Rule ${rule.id} has requiresDosingApproval action missing rationale`
        );
      }
    }
  }

  return true;
}

/**
 * Load and validate all rule files. Caches the result.
 * Throws on validation failure.
 *
 * @returns {Array<Object>} Flat array of all validated rules
 */
function loadRules() {
  if (cachedRules) return cachedRules;

  const allRules = [];
  const files = [
    { rules: HRT_RULES, source: 'hrt-rules.js' },
    { rules: PEPTIDE_RULES, source: 'peptide-rules.js' },
    { rules: FUNCTIONAL_MED_RULES, source: 'functional-med-rules.js' }
  ];

  const seenIds = new Set();

  for (const { rules, source } of files) {
    if (!Array.isArray(rules)) {
      throw new Error(`[KnowledgeBase] ${source} did not export a rule array`);
    }
    for (const rule of rules) {
      validateRule(rule, source);
      if (seenIds.has(rule.id)) {
        throw new Error(`[KnowledgeBase] Duplicate rule id ${rule.id} in ${source}`);
      }
      seenIds.add(rule.id);
      allRules.push({ ...rule, _source: source });
    }
  }

  cachedRules = allRules;
  console.log(`[KnowledgeBase] Loaded ${allRules.length} domain rules from ${files.length} files`);
  return allRules;
}

/**
 * Get rules filtered by rule_type.
 *
 * @param {string} ruleType - e.g. 'hormone_lab_alert', 'hrt_initiation', 'peptide_titration'
 * @returns {Array<Object>}
 */
function getRulesByType(ruleType) {
  return loadRules().filter(r => r.rule_type === ruleType);
}

/**
 * Get rules filtered by category.
 *
 * @param {string} category - e.g. 'hrt_male', 'glp1_t2dm', 'thyroid', 'interaction'
 * @returns {Array<Object>}
 */
function getRulesByCategory(category) {
  return loadRules().filter(r => r.category === category);
}

/**
 * Get all safety / interaction rules. These are evaluated FIRST so they can
 * block other rule types via their `blocksRuleTypes` field.
 *
 * @returns {Array<Object>}
 */
function getInteractionRules() {
  return loadRules().filter(r => r.category === 'interaction');
}

/**
 * Get a rule by id. Returns null if not found.
 *
 * @param {string} id
 * @returns {Object|null}
 */
function getRuleById(id) {
  return loadRules().find(r => r.id === id) || null;
}

/**
 * Reset the cache. Primarily for tests that load mutated rule sets.
 */
function resetCache() {
  cachedRules = null;
}

module.exports = {
  loadRules,
  getRulesByType,
  getRulesByCategory,
  getInteractionRules,
  getRuleById,
  resetCache,
  validateRule  // Exported for unit tests
};
