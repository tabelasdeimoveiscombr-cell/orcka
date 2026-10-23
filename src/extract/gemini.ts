import { GoogleGenAI } from "@google/genai";
import { zodToJsonSchema } from "zod-to-json-schema";
import { logger } from "../utils/logger.js";
import { withExponentialBackoff } from "../utils/retry.js";
import { pdfExtractionPrompt } from "./prompts.js";
import {
  pdfExtractionSchema,
  validatePdfExtraction,
  type ValidatedPdfExtraction,
} from "./schemas.js";

export type PdfGenerator = (input: {
  base64: string;
  prompt: string;
  responseSchema: ReturnType<typeof zodToJsonSchema>;
}) => Promise<string>;

function isRateLimitError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    status?: number;
    statusCode?: number;
    code?: number | string;
  };
  return (
    candidate.status === 429 ||
    candidate.statusCode === 429 ||
    candidate.code === 429 ||
    candidate.code === "429"
  );
}

const generateWithGemini: PdfGenerator = async ({
  base64,
  prompt,
  responseSchema,
}) => {
  const { env } = await import("../config/env.js");
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "application/pdf", data: base64 } },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema,
    },
  });
  if (!response.text) throw new Error("Gemini retornou resposta vazia.");
  return response.text;
};

export async function extractPdf(
  pdf: Buffer,
  generate: PdfGenerator = generateWithGemini,
): Promise<ValidatedPdfExtraction> {
  const responseSchema = zodToJsonSchema(pdfExtractionSchema, {
    target: "openApi3",
    $refStrategy: "none",
  });
  const responseText = await withExponentialBackoff(
    () =>
      generate({
        base64: pdf.toString("base64"),
        prompt: pdfExtractionPrompt,
        responseSchema,
      }),
    {
      attempts: 3,
      shouldRetry: isRateLimitError,
      wait: async (milliseconds) => {
        logger.warn(
          { delayMs: milliseconds },
          "Gemini limitou a taxa; tentando novamente",
        );
        await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
      },
    },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("Gemini retornou JSON inválido.");
  }
  return validatePdfExtraction(parsed);
}
