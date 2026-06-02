const crypto = require("crypto");

function headerValue(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual || "");
  const expectedBuffer = Buffer.from(expected || "");
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireAdmin(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    const error = new Error("ADMIN_TOKEN is required");
    error.statusCode = 503;
    throw error;
  }

  const provided = headerValue(req, "x-admin-token");
  if (!provided || !safeEqual(provided, expected)) {
    const error = new Error("Admin authorization required");
    error.statusCode = 401;
    throw error;
  }
}

module.exports = { requireAdmin };
