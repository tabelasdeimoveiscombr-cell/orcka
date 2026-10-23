import { z } from "zod";

const nullableText = z.string().nullable();
const nullableNumber = z.number().finite().nullable();
const nullableObject = z.record(z.string(), z.unknown()).nullable();

export const ownerExtractionSchema = z
  .object({
    tipo_pessoa: z.enum(["fisica", "juridica"]).nullable(),
    nome: nullableText,
    telefone_residencial: nullableText,
    telefone_celular: nullableText,
    telefone_comercial: nullableText,
    email: nullableText,
    identificador_externo: nullableText,
    local_chaves: nullableText,
    origem: nullableText,
    motivo_venda: nullableText,
    regiao: nullableText,
    dados_extras: z.record(z.string(), z.unknown()),
  })
  .nullable();

export const unitExtractionSchema = z.object({
  identificacao: nullableText,
  dormitorios: nullableNumber.refine((value) => value === null || Number.isInteger(value)),
  suites: nullableNumber.refine((value) => value === null || Number.isInteger(value)),
  vagas: nullableNumber.refine((value) => value === null || Number.isInteger(value)),
  area_privativa: nullableNumber,
  preco: nullableNumber,
  condicoes_pagamento: z.record(z.string(), z.unknown()).nullable(),
  disponivel: z.boolean().nullable(),
  subtipo: nullableText.optional(),
  finalidade: nullableText.optional(),
  condicao: nullableText.optional(),
  banheiros: nullableNumber.optional(),
  lavabos: nullableNumber.optional(),
  salas: nullableNumber.optional(),
  area_total: nullableNumber.optional(),
  preco_venda: nullableNumber.optional(),
  preco_locacao: nullableNumber.optional(),
  valor_iptu: nullableNumber.optional(),
  valor_condominio: nullableNumber.optional(),
  caracteristicas: z.array(z.string()).optional(),
  acabamentos: z.array(z.string()).optional(),
  documentacao: nullableObject.optional(),
  ocupacao: nullableText.optional(),
  temporada: nullableObject.optional(),
  proprietario: ownerExtractionSchema.optional(),
});

export const pdfExtractionSchema = z.object({
  tipo_documento: z.enum(["tabela_precos", "memorial", "book", "outro"]),
  cidade: nullableText,
  bairro: nullableText,
  endereco: nullableText,
  cep: nullableText,
  tipo_empreendimento: z
    .enum(["apartamento", "casa_condominio", "comercial", "outro"])
    .nullable(),
  status_obra: nullableText,
  previsao_entrega: nullableText,
  descricao: nullableText,
  dados_extras: z.record(z.string(), z.unknown()),
  subtipos: z.array(z.string()).optional(),
  finalidades: z.array(z.string()).optional(),
  endereco_extras: nullableObject.optional(),
  composicao: nullableObject.optional(),
  valores: nullableObject.optional(),
  condicoes_pagamento: nullableObject.optional(),
  caracteristicas_predio: z.array(z.string()).optional(),
  acabamentos: z.array(z.string()).optional(),
  documentacao: nullableObject.optional(),
  utilidades: nullableObject.optional(),
  temporada: nullableObject.optional(),
  ocupacao: nullableText.optional(),
  registro_incorporacao: nullableText.optional(),
  ponto_referencia: nullableText.optional(),
  proprietario: ownerExtractionSchema.optional(),
  unidades: z.array(unitExtractionSchema),
});

export type PdfExtraction = z.infer<typeof pdfExtractionSchema>;

export interface ValidatedPdfExtraction {
  data: PdfExtraction;
  precisaRevisao: boolean;
  motivoRevisao: string | null;
  unidadesValidas: PdfExtraction["unidades"];
}

export function validatePdfExtraction(value: unknown): ValidatedPdfExtraction {
  const data = pdfExtractionSchema.parse(value);
  const reasons = new Set<string>();
  const unidadesValidas = data.unidades.filter((unit) => {
    if (!unit.identificacao?.trim()) {
      reasons.add("Uma ou mais unidades vieram sem identificação.");
      return false;
    }
    if (unit.preco === null || unit.preco <= 0) {
      reasons.add("Há unidade sem preço válido.");
    }
    if (unit.area_privativa !== null && (unit.area_privativa <= 0 || unit.area_privativa > 2000)) {
      reasons.add("Há área privativa ausente ou fora do intervalo esperado.");
    }
    if (unit.disponivel === null) {
      reasons.add("A disponibilidade de uma ou mais unidades não foi informada.");
    }
    return true;
  });

  if (data.tipo_documento === "tabela_precos" && data.unidades.length === 0) {
    reasons.add("Tabela classificada sem unidades extraídas.");
  }
  for (const [label, value] of Object.entries(data.valores ?? {})) {
    if (typeof value === "number" && value < 0) {
      reasons.add(`O valor ${label} não pode ser negativo.`);
    }
  }

  return {
    data,
    precisaRevisao: reasons.size > 0,
    motivoRevisao: reasons.size > 0 ? [...reasons].join(" ") : null,
    unidadesValidas,
  };
}