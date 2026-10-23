import type { SupabaseClient } from "@supabase/supabase-js";
import type { InventoryDiff } from "./diff.js";

function throwOnError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

async function updateInBatches(
  client: SupabaseClient,
  table: string,
  column: string,
  values: string[],
  update: Record<string, unknown>,
): Promise<void> {
  for (let index = 0; index < values.length; index += 400) {
    const batch = values.slice(index, index + 400);
    const { error } = await client.from(table).update(update).in(column, batch);
    throwOnError(error);
  }
}

async function softDeleteProjectRows(
  client: SupabaseClient,
  projectIds: string[],
  deletedAt: string,
): Promise<void> {
  if (projectIds.length === 0) return;
  await updateInBatches(client, "empreendimentos", "id", projectIds, {
    deleted_at: deletedAt,
  });
  await updateInBatches(client, "unidades", "empreendimento_id", projectIds, {
    deleted_at: deletedAt,
  });
  await updateInBatches(client, "midias", "empreendimento_id", projectIds, {
    deleted_at: deletedAt,
  });
  await updateInBatches(client, "arquivos_drive", "empreendimento_id", projectIds, {
    status: "removido",
    deleted_at: deletedAt,
  });
}

export async function applyRemovals(
  client: SupabaseClient,
  diff: InventoryDiff,
  deletedAt = new Date().toISOString(),
): Promise<number> {
  if (!diff.safeToRemove) return 0;

  const removedCompanyIds = diff.removedFolders
    .filter((folder) => folder.depth === 1)
    .map((folder) => folder.drive_folder_id);
  const removedProjectIds = diff.removedFolders
    .filter((folder) => folder.depth === 2)
    .map((folder) => folder.drive_folder_id);

  let projectRows: Array<{ id: string; drive_folder_id: string }> = [];
  if (removedCompanyIds.length > 0) {
    const { data, error } = await client
      .from("empreendimentos")
      .select("id,drive_folder_id")
      .in("construtora_id", removedCompanyIds);
    throwOnError(error);
    projectRows = (data ?? []) as typeof projectRows;
    await updateInBatches(client, "construtoras", "drive_folder_id", removedCompanyIds, {
      deleted_at: deletedAt,
    });
  }

  const projectDriveIds = new Set([
    ...removedProjectIds,
    ...projectRows.map((project) => project.drive_folder_id),
  ]);
  let projectIds = projectRows.map((project) => project.id);
  if (removedProjectIds.length > 0) {
    const { data, error } = await client
      .from("empreendimentos")
      .select("id")
      .in("drive_folder_id", removedProjectIds);
    throwOnError(error);
    projectIds = [...new Set([...projectIds, ...(data ?? []).map((row) => row.id)])];
  }
  await softDeleteProjectRows(client, projectIds, deletedAt);

  const removedFileIds = diff.removedFiles.map((file) => file.drive_file_id);
  await updateInBatches(client, "unidades", "origem_arquivo_id", removedFileIds, {
    deleted_at: deletedAt,
  });
  await updateInBatches(client, "midias", "origem_arquivo_id", removedFileIds, {
    deleted_at: deletedAt,
  });
  await updateInBatches(client, "arquivos_drive", "drive_file_id", removedFileIds, {
    status: "removido",
    deleted_at: deletedAt,
  });

  const removedFolderRows = [...projectDriveIds, ...removedCompanyIds];
  await updateInBatches(
    client,
    "arquivos_drive",
    "drive_file_id",
    removedFolderRows,
    { status: "removido", deleted_at: deletedAt },
  );

  return removedFileIds.length + removedFolderRows.length;
}