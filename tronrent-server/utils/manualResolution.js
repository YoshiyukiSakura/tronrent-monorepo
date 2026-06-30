"use strict";

const { createHttpError } = require("./httpErrors");

const NOTE_MIN_LENGTH = 8;
const NOTE_MAX_LENGTH = 1000;
const ACTOR_MAX_LENGTH = 120;
const EVIDENCE_ID_MAX_LENGTH = 128;

function readAdminActor(req) {
  const actor =
    req && typeof req.get === "function" ? String(req.get("x-admin-actor") || "").trim() : "";
  if (!actor) {
    throw createHttpError(400, "x-admin-actor is required for manual resolution");
  }
  if (actor.length > ACTOR_MAX_LENGTH) {
    throw createHttpError(400, "x-admin-actor is too long");
  }
  return actor;
}

function readResolutionNote(note) {
  const value = String(note || "").trim();
  if (value.length < NOTE_MIN_LENGTH) {
    throw createHttpError(400, "Manual resolution note is too short");
  }
  if (value.length > NOTE_MAX_LENGTH) {
    throw createHttpError(400, "Manual resolution note is too long");
  }
  return value;
}

function readEvidenceId(value, fieldName, { required }) {
  const text = String(value || "").trim();
  if (!text) {
    if (required) {
      throw createHttpError(400, `${fieldName} is required for successful manual resolution`);
    }
    return null;
  }
  if (text.length > EVIDENCE_ID_MAX_LENGTH || /\s/.test(text)) {
    throw createHttpError(400, `${fieldName} is invalid`);
  }
  return text;
}

function buildManualResolution({
  resolution,
  note,
  resolvedBy,
  evidenceField,
  evidenceValue,
  requireEvidence,
  now = new Date(),
}) {
  const manualResolution = {
    resolution,
    note: readResolutionNote(note),
    resolvedBy,
    resolvedAt: now.toISOString(),
    resolvedFromIndeterminate: true,
  };

  const evidence = readEvidenceId(evidenceValue, evidenceField, {
    required: requireEvidence,
  });
  if (evidence) {
    manualResolution[evidenceField] = evidence;
  }

  return manualResolution;
}

function serializeManualResolution(manualResolution) {
  if (!manualResolution || typeof manualResolution !== "object") {
    return null;
  }

  return {
    resolution: manualResolution.resolution,
    note: manualResolution.note,
    resolvedBy: manualResolution.resolvedBy,
    resolvedAt: manualResolution.resolvedAt,
    resolvedFromIndeterminate: Boolean(
      manualResolution.resolvedFromIndeterminate
    ),
    upstreamOrderId: manualResolution.upstreamOrderId || undefined,
    txid: manualResolution.txid || undefined,
  };
}

module.exports = {
  buildManualResolution,
  readAdminActor,
  serializeManualResolution,
};
