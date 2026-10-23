import { appendFile } from "node:fs/promises";
import { z } from "zod";
import { createDriveClient } from "../drive/client.js";
import { listDriveInventory } from "../drive/inventory.js";
import { env } from "../config/env.js";
import { supabase } from "../db/supabase.js";
import { persistInventory } from "../db/repositories/drive.js";
import {
  createSyncExecution,
  finishSyncExecution,
  listPendingFileIds,
  loadSyncSnapshot,
} from "../db/repositories/sync.js";
import { logger } from "../utils/logger.js";
import { calculateInventoryDiff } from "../sync/diff.js";
import { applyRemovals } from "../sync/remover.js";
import { processPendingFiles } from "../sync/processor.js";

const optionsSchema = z.object({
  dryRun: z.boolean(),
  only: z.string().min(1).optional(),
});

const zeroCounts = () => ({
  criados: 0,
  atualizados: 0,
  removidos: 0,
  ignorados: 0,
  erros: 0,
  processados: 0,
  pdfs: 0,
  unidades_criadas: 0,
  unidades_atualizadas: 0,
});

function selectOnlyEntries(
  entries: Awaited<ReturnType<typeof listDriveInventory>>["entries"],
  only?: string,
) {
  if (!only) return entries;
  const selected = entries.find(
    (entry) =>
      entry.driveFileId === only &&
      entry.kind === "folder" &&
      (entry.depth === 1 || entry.depth === 2),
  );
  if (!selected) {
    throw new Error(
      "--only precisa apontar para uma construtora ou empreendimento inventariado.",
    );
  }
  return entries.filter(
    (entry) =>
      entry.driveFileId === only ||
      entry.companyDriveId === only ||
      entry.projectDriveId === only,
  );
}

async function writeGitHubSummary(lines: string[]): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) await appendFile(summaryPath, `${lines.join("\n")}\n`);
}

async function sendRebuildWebhook(
  payload: Record<string, unknown>,
): Promise<void> {
  if (!env.REBUILD_WEBHOOK_URL) return;
  const response = await fetch(env.REBUILD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Webhook de rebuild respondeu HTTP ${response.status}.`);
  }
}

export async function runSync(args = process.argv.slice(2)): Promise<void> {
  const options = optionsSchema.parse({
    dryRun: args.includes("--dry-run"),
    only: args.find((argument) => argument.startsWith("--only="))?.slice(7),
  });
  const unexpectedArgs = args.filter(
    (argument) => argument !== "--dry-run" && !argument.startsWith("--only="),
  );
  if (unexpectedArgs.length > 0) {
    throw new Error(
      `Argumentos não reconhecidos: ${unexpectedArgs.join(", ")}`,
    );
  }

  const counts = zeroCounts();
  const executionId = options.dryRun
    ? null
    : await createSyncExecution(supabase, "completo");

  try {
    const drive = createDriveClient();
    const inventory = await listDriveInventory(drive, env.DRIVE_ROOT_FOLDER_ID);
    const entries = selectOnlyEntries(inventory.entries, options.only);
    let snapshot = await loadSyncSnapshot(supabase, options.only);
    const diff = calculateInventoryDiff(
      entries,
      snapshot.files,
      snapshot.folders,
      {
        complete: true,
        only: options.only,
      },
    );

    counts.criados = diff.created.length;
    counts.atualizados = diff.updated.length;
    counts.ignorados = diff.unchanged.length;

    if (options.dryRun) {
      const plan = [
        ...diff.created.map((entry) => `CRIAR ${entry.path}`),
        ...diff.updated.map((entry) => `ATUALIZAR ${entry.path}`),
        ...diff.removedFiles.map((file) => `REMOVER ${file.caminho}`),
        ...diff.removedFolders.map(
          (folder) => `REMOVER PASTA ${folder.drive_folder_id}`,
        ),
        ...diff.unchanged.map((entry) => `IGNORAR ${entry.path}`),
      ];
      for (const item of plan) logger.info(item);
      logger.info(
        {
          ...counts,
          safeToRemove: diff.safeToRemove,
          alertReason: diff.alertReason,
        },
        "Plano dry-run; nenhuma gravação foi feita",
      );
      await writeGitHubSummary([
        "## Orcka sync (dry-run)",
        `- Criar: ${counts.criados}`,
        `- Atualizar: ${counts.atualizados}`,
        `- Remover: ${diff.removedFiles.length + diff.removedFolders.length}`,
        `- Ignorar: ${counts.ignorados}`,
        ...(diff.alertReason ? [`- Alerta: ${diff.alertReason}`] : []),
      ]);
      return;
    }

    if (!diff.safeToRemove) {
      const summary = diff.alertReason ?? "Trava de remoção ativada.";
      await finishSyncExecution(supabase, executionId!, {
        status: "alerta",
        counts,
        summary,
      });
      await writeGitHubSummary(["## Orcka sync: alerta", `- ${summary}`]);
      logger.warn({ summary }, "Execução encerrada pela trava de segurança");
      return;
    }

    const persisted = await persistInventory(
      supabase,
      entries,
      inventory.completedAt,
    );
    counts.criados = Math.max(counts.criados, persisted.created);
    counts.atualizados = Math.max(counts.atualizados, persisted.updated);
    counts.ignorados = Math.max(counts.ignorados, persisted.ignored);

    counts.removidos = await applyRemovals(supabase, diff);
    snapshot = await loadSyncSnapshot(supabase, options.only);
    const pendingIds = await listPendingFileIds(supabase);
    const pendingEntries = entries.filter(
      (entry) => entry.kind === "file" && pendingIds.has(entry.driveFileId),
    );
    const processed = await processPendingFiles({
      client: supabase,
      drive,
      entries: pendingEntries,
      projectIdsByDriveId: snapshot.projectIdsByDriveId,
      maxPdfs: env.MAX_PDFS_PER_RUN,
      concurrency: 3,
    });
    counts.erros = processed.failed;
    counts.processados = processed.processed;
    counts.pdfs = processed.pdfsProcessed;
    counts.unidades_criadas = processed.unitsCreated;
    counts.unidades_atualizadas = processed.unitsUpdated;

    const summary = [
      `criados=${counts.criados}`,
      `atualizados=${counts.atualizados}`,
      `removidos=${counts.removidos}`,
      `ignorados=${counts.ignorados}`,
      `erros=${counts.erros}`,
      `pdfs=${counts.pdfs}`,
    ].join(", ");
    await finishSyncExecution(supabase, executionId!, {
      status: "concluido",
      counts,
      summary,
    });
    await writeGitHubSummary([
      "## Orcka sync",
      `- Criados: ${counts.criados}`,
      `- Atualizados: ${counts.atualizados}`,
      `- Removidos: ${counts.removidos}`,
      `- Ignorados: ${counts.ignorados}`,
      `- Processados: ${counts.processados}`,
      `- PDFs processados: ${counts.pdfs}`,
      `- Unidades criadas/atualizadas: ${counts.unidades_criadas}/${counts.unidades_atualizadas}`,
      `- Erros isolados: ${counts.erros}`,
    ]);
    try {
      await sendRebuildWebhook({ executionId, status: "concluido", counts });
    } catch (error) {
      logger.error(
        { err: error },
        "Falha isolada ao acionar webhook de rebuild",
      );
    }
    logger.info({ executionId, counts }, "Sincronização concluída");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro desconhecido";
    logger.error({ executionId, err: error }, "Falha crítica na sincronização");
    if (executionId) {
      try {
        await finishSyncExecution(supabase, executionId, {
          status: "alerta",
          counts: { ...counts, erros: counts.erros + 1 },
          summary: `Execução interrompida sem aplicar remoções: ${message}`,
        });
      } catch (finishError) {
        logger.error(
          { executionId, err: finishError },
          "Falha ao registrar execução interrompida",
        );
      }
    }
    await writeGitHubSummary([
      "## Orcka sync: alerta",
      `- A execução foi interrompida sem aplicar remoções: ${message}`,
    ]);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSync().catch(() => {
    process.exitCode = 1;
  });
}
