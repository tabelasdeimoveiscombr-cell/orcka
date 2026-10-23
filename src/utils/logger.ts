import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "GOOGLE_SERVICE_ACCOUNT_JSON",
      "SUPABASE_SERVICE_ROLE_KEY",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "GEMINI_API_KEY",
      "*.private_key",
      "*.client_email",
    ],
    censor: "[REDACTED]",
  },
});
