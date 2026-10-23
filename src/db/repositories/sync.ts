import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PreviousDriveFile,
  PreviousDriveFolder,
} from "../../sync/diff.js";

export interface SyncSnapshot {
  files: PreviousDriveFile[];
  folders: PreviousDriveFolder[];
  projectIdsByDriveId: Map<string, string>;
  projectIds: string[];
}

async function loadAll<T>(
  requestPage: (
    from: number,
    to: number,
  ) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await requestPage(from, from + 999);
    if (result.error) throw new Error(result.error.message);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export async function loadSyncSnapshot(
  client: SupabaseClient,
  only?: string,
): Promise<SyncSnapshot> {
  let companies = await loadAll(async (from, to) => {
    const query = client
      .from("construtoras")
      .select("id,drive_folder_id")
      .is("deleted_at", null);
    const { data, error } = await (only
      ? query.eq("drive_folder_id", only).range(from, to)
      : query.range(from, to));
    return {
      data: data as Array<{ id: string; drive_folder_id: string }> | null,
      error,
    };
  });

  const selectedCompany = companies.find(
    (company) => company.drive_folder_id === only,
  );
  const projects = await loadAll(async (from, to) => {
    const query = client
      .from("empreendimentos")
      .select("id,drive_folder_id,construtora_id")
      .is("deleted_at", null);
    const scopedQuery = !only
      ? query
      : selectedCompany
        ? query.eq("construtora_id", selectedCompany.id)
        : query.eq("drive_folder_id", only);
    const { data, error } = await scopedQuery.range(from, to);
    return {
      data: data as Array<{
        id: string;
        drive_folder_id: string;
        construtora_id: string;
      }> | null,
      error,
    };
  });
  if (only && !selectedCompany) {
    const parentCompanyIds = [
      ...new Set(projects.map((project) => project.construtora_id)),
    ];
    companies =
      parentCompanyIds.length === 0
        ? []
        : await loadAll(async (from, to) => {
            const { data, error } = await client
              .from("construtoras")
              .select("id,drive_folder_id")
              .is("deleted_at", null)
              .in("id", parentCompanyIds)
              .range(from, to);
            return {
              data: data as Array<{
                id: string;
                drive_folder_id: string;
              }> | null,
              error,
            };
          });
  }
  const projectIds = projects.map((project) => project.id);

  const files = await loadAll(async (from, to) => {
    const query = client
      .from("arquivos_drive")
      .select(
        "drive_file_id,nome,mime_type,parent_id,caminho,md5,modified_time,version,tamanho,status,deleted_at",
      )
      .is("deleted_at", null);
    const scopedQuery = !only
      ? query
      : projectIds.length > 0
        ? query.in("empreendimento_id", projectIds)
        : null;
    if (!scopedQuery) return { data: [], error: null };
    const { data, error } = await scopedQuery.range(from, to);
    return { data: data as PreviousDriveFile[] | null, error };
  });

  return {
    files,
    folders: [
      ...companies.map((company) => ({
        drive_folder_id: company.drive_folder_id,
        depth: 1 as const,
        company_drive_folder_id: company.drive_folder_id,
      })),
      ...projects.map((project) => ({
        drive_folder_id: project.drive_folder_id,
        depth: 2 as const,
        company_drive_folder_id:
          companies.find((company) => company.id === project.construtora_id)
            ?.drive_folder_id ?? null,
      })),
    ],
    projectIdsByDriveId: new Map(
      projects.map((project) => [project.drive_folder_id, project.id]),
    ),
    projectIds,
  };
}

export async function createSyncExecution(
  client: SupabaseClient,
  mode: "completo" | "dry_run",
): Promise<string> {
  const { data, error } = await client
    .from("execucoes_sync")
    .insert({ modo: mode, status: "executando" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function finishSyncExecution(
  client: SupabaseClient,
  executionId: string,
  input: {
    status: "concluido" | "alerta" | "erro";
    counts: Record<string, number>;
    summary: string;
  },
): Promise<void> {
  const { error } = await client
    .from("execucoes_sync")
    .update({
      finalizado_em: new Date().toISOString(),
      status: input.status,
      contagens: input.counts,
      log_resumo: input.summary,
    })
    .eq("id", executionId);
  if (error) throw new Error(error.message);
}

export async function listPendingFileIds(
  client: SupabaseClient,
  projectIds?: string[],
): Promise<Set<string>> {
  if (projectIds && projectIds.length === 0) return new Set();
  const files = await loadAll(async (from, to) => {
    const query = client
      .from("arquivos_drive")
      .select("drive_file_id")
      .eq("status", "pendente")
      .is("deleted_at", null);
    const scopedQuery = projectIds
      ? query.in("empreendimento_id", projectIds)
      : query;
    const { data, error } = await scopedQuery.range(from, to);
    return {
      data: data as Array<{ drive_file_id: string }> | null,
      error,
    };
  });
  return new Set(files.map((file) => file.drive_file_id));
}
