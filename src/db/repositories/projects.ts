import type { SupabaseClient } from "@supabase/supabase-js";
import type { ValidatedPdfExtraction } from "../../extract/schemas.js";

function throwOnError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function persistPdfExtraction(
  client: SupabaseClient,
  projectId: string,
  driveFileId: string,
  extraction: ValidatedPdfExtraction,
): Promise<{ unitsCreated: number; unitsUpdated: number }> {
  const data = extraction.data;
  const projectFields: Record<string, unknown> = {
    precisa_revisao: extraction.precisaRevisao,
    motivo_revisao: extraction.motivoRevisao,
  };
  const optionalProjectFields: Array<[string, unknown]> = [
    ["cidade", data.cidade],
    ["bairro", data.bairro],
    ["endereco", data.endereco],
    ["cep", data.cep],
    ["tipo", data.tipo_empreendimento],
    ["status_obra", data.status_obra],
    ["previsao_entrega", data.previsao_entrega],
    ["descricao", data.descricao],
    ["subtipos", data.subtipos],
    ["finalidades", data.finalidades],
    ["endereco_extras", data.endereco_extras],
    ["composicao", data.composicao],
    ["valores", data.valores],
    ["condicoes_pagamento", data.condicoes_pagamento],
    ["caracteristicas_predio", data.caracteristicas_predio],
    ["acabamentos", data.acabamentos],
    ["documentacao", data.documentacao],
    ["utilidades", data.utilidades],
    ["temporada", data.temporada],
    ["ocupacao", data.ocupacao],
    ["registro_incorporacao", data.registro_incorporacao],
    ["ponto_referencia", data.ponto_referencia],
  ];
  for (const [field, value] of optionalProjectFields) {
    if (value !== null && value !== undefined) projectFields[field] = value;
  }
  if (Object.keys(data.dados_extras).length > 0) {
    projectFields.dados_extras = data.dados_extras;
  }

  const { error: projectError } = await client
    .from("empreendimentos")
    .update(projectFields)
    .eq("id", projectId);
  throwOnError(projectError);

  const units = extraction.unidadesValidas.filter(
    (unit): unit is typeof unit & { identificacao: string } =>
      unit.identificacao !== null,
  );
  if (units.length === 0) return { unitsCreated: 0, unitsUpdated: 0 };

  const identifiers = units.map((unit) => unit.identificacao);
  const { data: existingRows, error: existingError } = await client
    .from("unidades")
    .select("id,identificacao,preco")
    .eq("empreendimento_id", projectId)
    .in("identificacao", identifiers);
  throwOnError(existingError);
  const existingByIdentification = new Map(
    (existingRows ?? []).map((row) => [row.identificacao, row]),
  );
  const rows = units.map((unit) => ({
    empreendimento_id: projectId,
    origem_arquivo_id: driveFileId,
    identificacao: unit.identificacao,
    dormitorios: unit.dormitorios,
    suites: unit.suites,
    vagas: unit.vagas,
    area_privativa: unit.area_privativa,
    preco: unit.preco,
    subtipo: unit.subtipo ?? null,
    finalidade: unit.finalidade ?? null,
    condicao: unit.condicao ?? null,
    banheiros: unit.banheiros ?? null,
    lavabos: unit.lavabos ?? null,
    salas: unit.salas ?? null,
    area_total: unit.area_total ?? null,
    preco_venda: unit.preco_venda ?? unit.preco,
    preco_locacao: unit.preco_locacao ?? null,
    valor_iptu: unit.valor_iptu ?? null,
    valor_condominio: unit.valor_condominio ?? null,
    caracteristicas: unit.caracteristicas ?? [],
    acabamentos: unit.acabamentos ?? [],
    documentacao: unit.documentacao ?? {},
    ocupacao: unit.ocupacao ?? null,
    temporada: unit.temporada ?? {},
    condicoes_pagamento: unit.condicoes_pagamento ?? {},
    disponivel: unit.disponivel,
    deleted_at: null,
  }));
  const { error: upsertError } = await client
    .from("unidades")
    .upsert(rows, { onConflict: "empreendimento_id,identificacao" });
  throwOnError(upsertError);

  const priceHistory = units.flatMap((unit) => {
    if (unit.preco === null) return [];
    const previous = existingByIdentification.get(unit.identificacao);
    if (!previous || previous.preco === null || Number(previous.preco) === unit.preco) {
      return [];
    }
    return [
      {
        unidade_id: previous.id,
        preco_anterior: previous.preco,
        preco_novo: unit.preco,
      },
    ];
  });
  if (priceHistory.length > 0) {
    const { error: historyError } = await client
      .from("historico_precos")
      .insert(priceHistory);
    throwOnError(historyError);
  }

  const owners = units.flatMap((unit) => {
    const owner = unit.proprietario ?? data.proprietario ?? null;
    if (!owner) return [];
    const hasOwnerData = Object.entries(owner).some(
      ([key, value]) =>
        key !== "dados_extras" &&
        value !== null &&
        value !== undefined &&
        value !== "",
    );
    if (!hasOwnerData) return [];
    return [
      {
        empreendimento_id: projectId,
        origem_arquivo_id: driveFileId,
        unidade_identificacao: unit.identificacao,
        tipo_pessoa: owner.tipo_pessoa,
        nome: owner.nome,
        telefone_residencial: owner.telefone_residencial,
        telefone_celular: owner.telefone_celular,
        telefone_comercial: owner.telefone_comercial,
        email: owner.email,
        identificador_externo: owner.identificador_externo,
        local_chaves: owner.local_chaves,
        origem: owner.origem,
        motivo_venda: owner.motivo_venda,
        regiao: owner.regiao,
        dados_extras: owner.dados_extras,
        deleted_at: null,
      },
    ];
  });
  if (owners.length > 0) {
    const { data: savedOwners, error: ownerError } = await client
      .from("proprietarios")
      .upsert(owners, { onConflict: "origem_arquivo_id,unidade_identificacao" })
      .select("id,unidade_identificacao");
    throwOnError(ownerError);
    for (const owner of savedOwners ?? []) {
      const { error } = await client
        .from("unidades")
        .update({ proprietario_id: owner.id })
        .eq("empreendimento_id", projectId)
        .eq("identificacao", owner.unidade_identificacao);
      throwOnError(error);
    }
  }

  return {
    unitsCreated: units.filter(
      (unit) => !existingByIdentification.has(unit.identificacao),
    ).length,
    unitsUpdated: units.filter((unit) =>
      existingByIdentification.has(unit.identificacao),
    ).length,
  };
}

export async function upsertMedia(
  client: SupabaseClient,
  input: {
    projectId: string;
    driveFileId: string;
    type: "foto" | "pdf";
    key: string;
    thumbnailKey?: string;
    width?: number;
    height?: number;
  },
): Promise<void> {
  const { error } = await client.from("midias").upsert(
    {
      empreendimento_id: input.projectId,
      origem_arquivo_id: input.driveFileId,
      tipo: input.type,
      r2_key: input.key,
      r2_thumb_key: input.thumbnailKey ?? null,
      largura: input.width ?? null,
      altura: input.height ?? null,
      deleted_at: null,
    },
    { onConflict: "origem_arquivo_id" },
  );
  throwOnError(error);
}

export async function updateProjectInfo(
  client: SupabaseClient,
  projectId: string,
  info: Record<string, string>,
): Promise<void> {
  const allowedFields = ["cidade", "bairro", "endereco", "cep", "descricao"];
  const fields = Object.fromEntries(
    Object.entries(info).filter(
      ([key, value]) => allowedFields.includes(key) && value.trim().length > 0,
    ),
  );
  if (Object.keys(fields).length === 0) return;

  const { error } = await client
    .from("empreendimentos")
    .update(fields)
    .eq("id", projectId);
  throwOnError(error);
}