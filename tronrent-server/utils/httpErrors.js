"use strict";

function createHttpError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) {
    error.details = details;
  }
  return error;
}

function sendHttpError(res, error) {
  const statusCode = error.statusCode || 500;
  return res.status(statusCode).json({
    success: false,
    message: error.message || "Internal server error",
    details: error.details,
  });
}

module.exports = {
  createHttpError,
  sendHttpError,
};
