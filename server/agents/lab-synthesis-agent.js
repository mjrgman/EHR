'use strict';

/**
 * LabSynthesisAgent — Phase 2b Chunk 6
 *
 * Role: bridge raw LabCorp result payloads (PDF/XML from client.fetchResults)
 * into the EHR's normalized lab view and broadcast LAB_SYNTHESIS_READY so
 * CDS + Domain Logic can evaluate the new values.
 *
 * Tier: 2 (Supervised). This agent transforms data — it never prescribes
 * or changes dosing. Downstream consumers (CDSAgent, DomainLogicAgent) carry
 * the clinical decisions.
 *
 * Two entry points:
 *   1. Direct: `await agent.process(context, { rawLabArtifact: {...} })`
 *      — used by the encounter pipeline when lab data is pre-attached to
 *      the agent-results bag by an orchestrator step.
 *   2. Message-driven: `agent.attachMessageBus(bus)` subscribes to
 *      LAB_RESULTED; when a result arrives it extracts the raw buffer
 *      from the message payload, synthesizes, and emits LAB_SYNTHESIS_READY.
 *
 * Design notes:
 *   - Parser NEVER throws (see server/integrations/labcorp/parser.js), so
 *     this agent surfaces failure via `ok: false` + `warnings[]` rather
 *     than rejecting promises. A failed synthesis still reports outcome
 *     to audit so a bad LabCorp payload is visible in the CATC timeline.
 *   - The LAB_RESULTED message payload carries `bufferBase64` rather than
 *     a raw Buffer because Buffers don't survive JSON.stringify / parse
 *     round-trips through the MessageBus DB persistence layer.
 *   - `LAB_ALIASES` normalization happens DOWNSTREAM in the functional-med
 *     engine — this agent preserves raw LabCorp test names verbatim so
 *     `code` and `displayName` both stay authoritative.
 */

const { BaseAgent } = require('./base-agent');
const parser = require('../integrations/labcorp/parser');

class LabSynthesisAgent extends BaseAgent {
  constructor(options = {}) {
    super('lab_synthesis', {
      description: 'Normalizes raw LabCorp PDF/XML results into the patient context',
      dependsOn: [],
      priority: 15,            // runs after Scribe, before CDS
      autonomyTier: 2,          // Supervised — data transform only
      ...options,
    });
    this._labResultedSubId = null;
  }

  /**
   * Synthesize a raw LabCorp artifact into normalized lab results.
   *
   * @param {Object} artifact
   * @param {string} artifact.contentType - 'application/xml' | 'application/pdf'
   * @param {Buffer} artifact.buffer - Raw bytes
   * @param {string} [artifact.externalOrderId] - For logging / audit traceability
   * @returns {Promise<Object>} Normalized parser output
   */
  async synthesizeRaw({ contentType, buffer, externalOrderId } = {}) {
    if (!buffer) {
      return {
        ok: false,
        warnings: ['synthesizeRaw: buffer is required'],
        results: [],
      };
    }

    const ct = (contentType || '').toLowerCase();
    let parsed;
    try {
      if (ct.includes('pdf')) {
        parsed = await parser.parsePdfResult(buffer);
      } else {
        // Default to XML — matches fetchResults wire format and the fake API server
        parsed = parser.parseXmlResult(buffer);
      }
    } catch (err) {
      // Defensive belt: parser contract says never throw, but if a future
      // change violates that we fail soft here rather than crashing the bus.
      return {
        ok: false,
        warnings: [`synthesizeRaw: parser threw: ${err.message}`],
        results: [],
      };
    }

    if (externalOrderId && parsed && !parsed.externalOrderId) {
      parsed.externalOrderId = externalOrderId;
    }
    return parsed;
  }

  /**
   * Main encounter-pipeline entry point.
   *
   * Looks for a `rawLabArtifact` in `agentResults` (placed there by an
   * earlier orchestrator step, typically the lab-results pull). If absent,
   * returns a no-op result rather than erroring — an encounter without new
   * labs shouldn't fail the pipeline.
   */
  async process(context = {}, agentResults = {}) {
    const artifact = agentResults.rawLabArtifact;
    if (!artifact || !artifact.buffer) {
      return {
        ok: true,
        skipped: true,
        reason: 'no rawLabArtifact attached — nothing to synthesize',
        results: [],
      };
    }

    const parsed = await this.synthesizeRaw(artifact);

    if (parsed.ok) {
      this.audit('RECOMMENDATION', {
        type: 'lab_synthesis',
        externalOrderId: artifact.externalOrderId || parsed.externalOrderId || null,
        resultCount: Array.isArray(parsed.results) ? parsed.results.length : 0,
      }, context);

      // Broadcast so CDS + Domain Logic can evaluate the new values.
      if (this.messageBus) {
        await this.sendMessage('broadcast', 'LAB_SYNTHESIS_READY', {
          externalOrderId: artifact.externalOrderId || parsed.externalOrderId || null,
          labOrderId: parsed.labOrderId || null,
          resultedAt: parsed.resultedAt || null,
          results: parsed.results || [],
          source: parsed.source || null,
        }, {
          patientId: context.patient?.id || null,
          encounterId: context.encounter?.id || null,
        });
      }
    } else {
      // Parse failure — log as a Level 3 (Minor) safety event. Minor because
      // the data just isn't available; the encounter isn't harmed.
      this.reportSafetyEvent(3,
        `LabCorp synthesis failed: ${(parsed.warnings || []).join('; ') || 'unknown reason'}`,
        context
      );
    }

    return parsed;
  }

  /**
   * Wire this agent into a MessageBus so it reacts to LAB_RESULTED events.
   * Separate from the constructor so agents can be instantiated without
   * a bus (unit tests) and attached later in the orchestrator.
   *
   * @param {Object} bus - MessageBus instance (real or test fake)
   */
  attachMessageBus(bus) {
    this.messageBus = bus;
    this._labResultedSubId = bus.subscribe('lab_synthesis', 'LAB_RESULTED', async (msg) => {
      await this._handleLabResultedMessage(msg);
    });
  }

  /**
   * Internal: unpack a LAB_RESULTED message, synthesize, emit LAB_SYNTHESIS_READY.
   * Errors are swallowed to a warning because the subscriber path should never
   * crash the sender — real MessageBus does the same (see _routeToSubscribers).
   */
  async _handleLabResultedMessage(msg) {
    let payload;
    try {
      payload = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : msg.payload;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[${this.name}] LAB_RESULTED payload not JSON: ${err.message}`);
      return;
    }

    const buffer = payload.bufferBase64
      ? Buffer.from(payload.bufferBase64, 'base64')
      : (payload.buffer || null);

    if (!buffer) {
      // eslint-disable-next-line no-console
      console.warn(`[${this.name}] LAB_RESULTED missing buffer/bufferBase64`);
      return;
    }

    const parsed = await this.synthesizeRaw({
      contentType: payload.contentType || 'application/xml',
      buffer,
      externalOrderId: payload.externalOrderId,
    });

    if (parsed.ok && this.messageBus) {
      await this.sendMessage('broadcast', 'LAB_SYNTHESIS_READY', {
        externalOrderId: payload.externalOrderId || null,
        labOrderId: parsed.labOrderId || null,
        resultedAt: parsed.resultedAt || null,
        results: parsed.results || [],
        source: parsed.source || null,
      }, {
        patientId: msg.patient_id || null,
        encounterId: msg.encounter_id || null,
      });
    }
  }
}

module.exports = { LabSynthesisAgent };
