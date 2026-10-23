import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ path: ".env.oauth" });
loadDotenv();

const optionalUrlSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const environmentSchema = z.object({
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().min(1),
  DRIVE_ROOT_FOLDER_ID: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1).default("orcka-media"),
  R2_PUBLIC_BASE_URL: optionalUrlSchema,
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1).default("gemini-flash-latest"),
  MAX_PDFS_PER_RUN: z.coerce.number().int().positive().default(15),
  REBUILD_WEBHOOK_URL: optionalUrlSchema,
});

export const env = environmentSchema.parse(process.env);
