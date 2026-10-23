import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriveInventoryEntry } from "../../drive/inventory.js";
import { slugify } from "../../utils/slug.js";

const batchSize = 400;

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function throwOnError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function persistInventory(
  client: SupabaseClient,
  entries: DriveInventoryEntry[],
  seenAt: string,
): Promise<{ created: number; updated: number; ignored: number }> {
  const companyFolders = entries.filter(
    (entry) => entry.kind === "folder" && entry.depth === 1,
  );
  const companyRows = companyFolders.map((folder) => ({
    drive_folder_id: folder.driveFileId,
    nome: folder.name,
    slug: `${slugify(folder.name) || "construtora"}-${folder.driveFileId.slice(-8)}`,
    deleted_at: null,
  }));

  const companyDriveIds = [
    ...new Set([
      ...companyRows.map((row) => row.drive_folder_id),
      ...entries
        .map((entry) => entry.companyDriveId)
        .filter((id): id is string => id !== null),
    ]),
  ];
  if (companyRows.length > 0) {
    const { error } = await client
      .from("construtoras")
      .upsert(companyRows, { onConflict: "drive_folder_id" })
      ;
    throwOnError(error);
  }

  let companiesByDriveId = new Map<string, string>();
  if (companyDriveIds.length > 0) {
    const { data, error } = await client
      .from("construtoras")
      .select("id,drive_folder_id")
      .in("drive_folder_id", companyDriveIds);
    throwOnError(error);
    companiesByDriveId = new Map(
      (data ?? []).map((row) => [row.drive_folder_id, row.id]),
    );
  }

  const projectFolders = entries.filter(
    (entry) => entry.kind === "folder" && entry.depth === 2,
  );
  const projectRows = projectFolders.flatMap((folder) => {
    const companyId = folder.companyDriveId
      ? companiesByDriveId.get(folder.companyDriveId)
      : undefined;
    return companyId
      ? [
          {
            drive_folder_id: folder.driveFileId,
            construtora_id: companyId,
            nome: folder.name,
            slug: `${slugify(folder.name) || "empreendimento"}-${folder.driveFileId.slice(-8)}`,
            deleted_at: null,
          },
        ]
      : [];
  });

  let projectsByDriveId = new Map<string, string>();
  if (projectRows.length > 0) {
    const { data, error } = await client
      .from("empreendimentos")
      .upsert(projectRows, { onConflict: "drive_folder_id" })
      .select("id,drive_folder_id");
    throwOnError(error);
    projectsByDriveId = new Map(
      (data ?? []).map((row) => [row.drive_folder_id, row.id]),
    );
  }

  const fileEntries = entries.filter(
    (entry) => entry.kind === "file" && entry.projectDriveId !== null,
  );
  let created = 0;
  let updated = 0;
  let ignored = 0;

  for (const batch of chunks(fileEntries, batchSize)) {
    const ids = batch.map((entry) => entry.driveFileId);
    const existingRows: Array<Record<string, unknown>> = [];
    for (const idBatch of chunks(ids, batchSize)) {
      const { data, error } = await client
        .from("arquivos_drive")
        .select("drive_file_id,nome,mime_type,parent_id,caminho,md5,modified_time,version,tamanho")
        .in("drive_file_id", idBatch);
      throwOnError(error);
      existingRows.push(...((data ?? []) as Array<Record<string, unknown>>));
    }

    const existingById = new Map(
      existingRows.map((row) => [String(row.drive_file_id), row]),
    );
    const changedRows: Array<Record<string, unknown>> = [];
    const unchangedIds: string[] = [];

    for (const entry of batch) {
      const projectId = entry.projectDriveId
        ? projectsByDriveId.get(entry.projectDriveId)
        : undefined;
      if (!projectId) continue;

      const values = {
        nome: entry.name,
        mime_type: entry.mimeType,
        parent_id: entry.parentId,
        caminho: entry.path,
        md5: entry.md5,
        modified_time: entry.modifiedTime,
        version: entry.version,
        tamanho: entry.size,
      };
      const previous = existingById.get(entry.driveFileId);
      const changed =
        !previous ||
        Object.entries(values).some(([key, value]) => previous[key] !== value);

      if (changed) {
        changedRows.push({
          drive_file_id: entry.driveFileId,
          ...values,
          empreendimento_id: projectId,
          status: "pendente",
          tentativas: 0,
          ultimo_erro: null,
          visto_em: seenAt,
          deleted_at: null,
        });
        if (previous) updated += 1;
        else created += 1;
      } else {
        unchangedIds.push(entry.driveFileId);
        ignored += 1;
      }
    }

    if (changedRows.length > 0) {
      const { error } = await client
        .from("arquivos_drive")
        .upsert(changedRows, { onConflict: "drive_file_id" });
      throwOnError(error);
    }
    for (const idBatch of chunks(unchangedIds, batchSize)) {
      const { error } = await client
        .from("arquivos_drive")
        .update({ visto_em: seenAt, deleted_at: null })
        .in("drive_file_id", idBatch);
      throwOnError(error);
    }
  }

  return { created, updated, ignored };
}