"use strict";

function formatMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta) || !Object.keys(meta).length) {
    return "";
  }
  return ` ${JSON.stringify(meta)}`;
}

function write(level, scope, message, meta) {
  const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}${formatMeta(meta)}`;
  const target = level === "ERROR" ? console.error : console.log;
  target(line);
}

function createLogger(scope) {
  const name = String(scope || "app");
  return {
    info(message, meta) {
      write("INFO", name, message, meta);
    },
    warn(message, meta) {
      write("WARN", name, message, meta);
    },
    error(message, meta) {
      write("ERROR", name, message, meta);
    }
  };
}

module.exports = {
  createLogger
};
