import { describe, expect, it, vi } from "vitest";
import { extractPdf } from "../src/extract/gemini.js";
import { pdfExtractionSchema } from "../src/extract/schemas.js";

const validExtraction = {
  tipo_documento: "tabela_precos",
  cidade: null,
  bairro: null,
  endereco: null,
  cep: null,
  tipo_empreendimento: null,
  status_obra: null,
  previsao_entrega: null,
  descricao: null,
  dados_extras: {},
  unidades: [
    {
      identificacao: "Apto 101",
      dormitorios: 2,
      suites: null,
      vagas: 1,
      area_privativa: 55,
      preco: 100000,
      condicoes_pagamento: null,
      disponivel: true,
    },
  ],
};

describe("extractPdf", () => {
  it("validates structured output and flags incomplete values for review", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        tipo_documento: "tabela_precos",
        cidade: null,
        bairro: null,
        endereco: null,
        cep: null,
        tipo_empreendimento: null,
        status_obra: null,
        previsao_entrega: null,
        descricao: null,
        dados_extras: {},
        unidades: [
          {
            identificacao: "Apto 101",
            dormitorios: 2,
            suites: null,
            vagas: 1,
            area_privativa: 55,
            preco: 0,
            condicoes_pagamento: null,
            disponivel: true,
          },
        ],
      }),
    );

    const result = await extractPdf(Buffer.from("pdf"), generate);

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        base64: Buffer.from("pdf").toString("base64"),
        responseSchema: expect.any(Object),
      }),
    );
    expect(result.precisaRevisao).toBe(true);
    expect(result.motivoRevisao).toContain("preço válido");
    expect(result.unidadesValidas).toHaveLength(1);
  });

  it("rejects negative values and malformed delivery dates", () => {
    expect(
      pdfExtractionSchema.safeParse({
        ...validExtraction,
        previsao_entrega: "2026-13-40",
        unidades: [{ ...validExtraction.unidades[0], dormitorios: -1 }],
      }).success,
    ).toBe(false);
  });

  it("retries rate-limit responses no more than three times", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ status: 429 });

    await expect(
      extractPdf(Buffer.from("pdf"), generate),
    ).rejects.toMatchObject({
      status: 429,
    });
    expect(generate).toHaveBeenCalledTimes(3);
  });
});
