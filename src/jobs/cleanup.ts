import { supabase } from "../db/supabase.js";
import { deleteR2Objects } from "../storage/r2.js";
import { logger } from "../utils/logger.js";

const batchSize = 500;

function getCutoff(): string {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  return cutoff.toISOString();
}

async function loadExpired<T>(
  table: string,
  columns: string,
  cutoff: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .lt("deleted_at", cutoff)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function deleteByIds(
  table: string,
  column: string,
  ids: string[],
): Promise<number> {
  let deleted = 0;
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize);
    const { data, error } = await supabase
      .from(table)
      .delete()
      .in(column, batch)
      .select(column);
    if (error) throw new Error(error.message);
    deleted += data?.length ?? batch.length;
  }
  return deleted;
}

export async function runCleanup(): Promise<Record<string, number>> {
  const cutoff = getCutoff();
  const counts: Record<string, number> = {};
  const media = await loadExpired<{
    id: string;
    r2_key: string;
    r2_thumb_key: string | null;
  }>("midias", "id,r2_key,r2_thumb_key", cutoff);

  const objectKeys = media.flatMap((item) =>
    [item.r2_key, item.r2_thumb_key].filter((key): key is string =>
      Boolean(key),
    ),
  );
  await deleteR2Objects(objectKeys);
  counts.objetos_r2 = objectKeys.length;
  counts.midias = await deleteByIds(
    "midias",
    "id",
    media.map((item) => item.id),
  );

  const units = await loadExpired<{ id: string }>("unidades", "id", cutoff);
  const unitIds = units.map((unit) => unit.id);
  counts.historico_precos = await deleteByIds(
    "historico_precos",
    "unidade_id",
    unitIds,
  );
  counts.unidades = await deleteByIds("unidades", "id", unitIds);

  const owners = await loadExpired<{ id: string }>(
    "proprietarios",
    "id",
    cutoff,
  );
  counts.proprietarios = await deleteByIds(
    "proprietarios",
    "id",
    owners.map((owner) => owner.id),
  );

  const files = await loadExpired<{ drive_file_id: string }>(
    "arquivos_drive",
    "drive_file_id",
    cutoff,
  );
  counts.arquivos_drive = await deleteByIds(
    "arquivos_drive",
    "drive_file_id",
    files.map((file) => file.drive_file_id),
  );

  const projects = await loadExpired<{ id: string }>(
    "empreendimentos",
    "id",
    cutoff,
  );
  counts.empreendimentos = await deleteByIds(
    "empreendimentos",
    "id",
    projects.map((project) => project.id),
  );

  const companies = await loadExpired<{ id: string }>(
    "construtoras",
    "id",
    cutoff,
  );
  counts.construtoras = await deleteByIds(
    "construtoras",
    "id",
    companies.map((company) => company.id),
  );

  logger.info(
    { cutoff, counts },
    "Limpeza física de registros expirados concluída",
  );
  return counts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCleanup().catch((error: unknown) => {
    logger.error({ err: error }, "Falha no job de limpeza");
    process.exitCode = 1;
  });
}
