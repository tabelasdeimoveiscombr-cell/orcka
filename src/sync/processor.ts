import { z } from "zod";
import pLimit from "p-limit";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { drive_v3 } from "googleapis";
import type { DriveInventoryEntry } from "../drive/inventory.js";
import { downloadDriveFile } from "../drive/download.js";
import { extractPdf } from "../extract/gemini.js";
import { processAndStoreImage, storePdf } from "../media/images.js";
import {
  persistPdfExtraction,
  updateProjectInfo,
  upsertMedia,
} from "../db/repositories/projects.js";
import { logger } from "../utils/logger.js";

const infoSchema = z.object({
  cidade: z.string().optional(),
  bairro: z.string().optional(),
  endereco: z.string().optional(),
  cep: z.string().optional(),
  descricao: z.string().optional(),
});

export interface ProcessCounts {
  processed: number;
  failed: number;
  skipped: number;
  pdfsProcessed: number;
  unitsCreated: number;
  unitsUpdated: number;
}

function parseInfo(content: string, fileName: string): Record<string, string> {
  if (fileName.toLowerCase().endsWith(".json")) {
    try {
      const parsed = infoSchema.safeParse(JSON.parse(content));
      if (parsed.success) {
        return Object.fromEntries(
          Object.entries(parsed.data).filter((entry): entry is [string, string] => Boolean(entry[1])),
        );
      }
    } catch {
      return {};
    }
  }

  const labels: Record<string, string> = {
    cidade: "cidade",
    bairro: "bairro",
    endereco: "endereco",
    endereço: "endereco",
    cep: "cep",
    descricao: "descricao",
    descrição: "descricao",
  };
  const extracted: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLocaleLowerCase("pt-BR");
    const field = labels[key];
    const value = line.slice(separator + 1).trim();
    if (field && value) extracted[field] = value;
  }
  return extracted;
}

function isInfoFile(entry: DriveInventoryEntry): boolean {
  const lowerName = entry.name.toLowerCase();
  return (
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".json") ||
    entry.mimeType === "application/vnd.google-apps.document" ||
    entry.mimeType === "application/vnd.google-apps.spreadsheet"
  );
}

async function setFileStatus(
  client: SupabaseClient,
  driveFileId: string,
  status: "processado" | "erro",
  errorMessage: string | null,
): Promise<void> {
  const update =
    status === "processado"
      ? {
          status,
          processado_em: new Date().toISOString(),
          ultimo_erro: null,
        }
      : {
          status,
          tentativas: 3,
          ultimo_erro: errorMessage,
        };
  const { error } = await client
    .from("arquivos_drive")
    .update(update)
    .eq("drive_file_id", driveFileId);
  if (error) throw new Error(error.message);
}

export async function processPendingFiles(input: {
  client: SupabaseClient;
  drive: drive_v3.Drive;
  entries: DriveInventoryEntry[];
  projectIdsByDriveId: Map<string, string>;
  maxPdfs: number;
  concurrency: number;
}): Promise<ProcessCounts> {
  const limit = pLimit(input.concurrency);
  const files = input.entries.filter((entry) => entry.kind === "file");
  const pdfFiles = files.filter((entry) => entry.mimeType === "application/pdf");
  const allowedPdfs = new Set(
    pdfFiles.slice(0, input.maxPdfs).map((entry) => entry.driveFileId),
  );
  const counts: ProcessCounts = {
    processed: 0,
    failed: 0,
    skipped: 0,
    pdfsProcessed: 0,
    unitsCreated: 0,
    unitsUpdated: 0,
  };

  await Promise.all(
    files.map((entry) =>
      limit(async () => {
        const projectId = entry.projectDriveId
          ? input.projectIdsByDriveId.get(entry.projectDriveId)
          : undefined;
        if (!projectId) {
          counts.skipped += 1;
          return;
        }
        if (entry.mimeType === "application/pdf" && !allowedPdfs.has(entry.driveFileId)) {
          counts.skipped += 1;
          return;
        }

        try {
          const download = await downloadDriveFile(
            input.drive,
            entry.effectiveDriveFileId,
            entry.mimeType,
          );
          if (entry.mimeType === "application/pdf") {
            const extraction = await extractPdf(download.buffer);
            const unitCounts = await persistPdfExtraction(
              input.client,
              projectId,
              entry.driveFileId,
              extraction,
            );
            const key = await storePdf(
              download.buffer,
              projectId,
              entry.driveFileId,
            );
            await upsertMedia(input.client, {
              projectId,
              driveFileId: entry.driveFileId,
              type: "pdf",
              key,
            });
            counts.pdfsProcessed += 1;
            counts.unitsCreated += unitCounts.unitsCreated;
            counts.unitsUpdated += unitCounts.unitsUpdated;
          } else if (entry.mimeType.startsWith("image/")) {
            const image = await processAndStoreImage(
              download.buffer,
              projectId,
              entry.driveFileId,
            );
            await upsertMedia(input.client, {
              projectId,
              driveFileId: entry.driveFileId,
              type: "foto",
              key: image.key,
              thumbnailKey: image.thumbnailKey,
              width: image.width,
              height: image.height,
            });
          } else if (isInfoFile(entry)) {
            const info = parseInfo(download.buffer.toString("utf8"), entry.name);
            await updateProjectInfo(input.client, projectId, info);
          } else {
            counts.skipped += 1;
            await setFileStatus(input.client, entry.driveFileId, "processado", null);
            return;
          }

          await setFileStatus(input.client, entry.driveFileId, "processado", null);
          counts.processed += 1;
        } catch (error) {
          counts.failed += 1;
          const message = error instanceof Error ? error.message : "Erro desconhecido";
          logger.error(
            { driveFileId: entry.driveFileId, path: entry.path, err: error },
            "Falha isolada ao processar arquivo do Drive",
          );
          try {
            await setFileStatus(input.client, entry.driveFileId, "erro", message);
          } catch (statusError) {
            logger.error(
              { driveFileId: entry.driveFileId, err: statusError },
              "Não foi possível registrar falha do arquivo",
            );
          }
        }
      }),
    ),
  );

  return counts;
}