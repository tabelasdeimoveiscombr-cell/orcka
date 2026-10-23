import "dotenv/config";
import { z } from "zod";

const googleServiceAccountSchema = z
  .string()
  .min(1)
  .transform((value, context) => {
    let credentials: unknown;

    try {
      credentials = JSON.parse(value);
    } catch {
      try {
        credentials = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Deve conter um JSON válido ou seu conteúdo em base64.",
        });
        return z.NEVER;
      }
    }

    const parsedCredentials = z
      .object({
        client_email: z.string().email(),
        private_key: z.string().min(1),
      })
      .passthrough()
      .safeParse(credentials);

    if (!parsedCredentials.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A credencial deve incluir client_email e private_key válidos.",
      });
      return z.NEVER;
    }

    return parsedCredentials.data;
  });

const optionalUrlSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const environmentSchema = z.object({
  GOOGLE_SERVICE_ACCOUNT_JSON: googleServiceAccountSchema,
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
