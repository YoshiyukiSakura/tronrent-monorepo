"use strict";

const crypto = require("node:crypto");
const { createHttpError } = require("./httpErrors");

function getAdminToken(req) {
  if (!req || typeof req.get !== "function") {
    return undefined;
  }
  return req.get("x-admin-token");
}

function requireEnabledAdminRoute({ req, enabledEnvVar, disabledMessage }) {
  if (process.env[enabledEnvVar] !== "true") {
    throw createHttpError(403, disabledMessage);
  }

  const expectedToken = process.env.DEPOSIT_WATCHER_ADMIN_TOKEN;
  const providedToken = getAdminToken(req);
  if (!expectedToken || !providedToken) {
    throw createHttpError(404, "Not found");
  }

  const expectedBuffer = Buffer.from(String(expectedToken), "utf8");
  const providedBuffer = Buffer.from(String(providedToken), "utf8");
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw createHttpError(404, "Not found");
  }
}

module.exports = {
  requireEnabledAdminRoute,
};
