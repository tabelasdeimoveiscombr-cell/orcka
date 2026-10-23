export const pdfExtractionPrompt = `
Analise o PDF imobiliário anexado. Responda somente com JSON válido, de acordo com o schema fornecido.

Regras:
- Classifique como tabela_precos, memorial, book ou outro.
- Extraia somente informações explicitamente presentes no documento.
- Não estime, complete ou invente valores. Use null quando o dado não estiver claro ou não existir.
- Valores monetários e áreas devem ser números, sem símbolos ou separadores de milhar.
- Mantenha a identificação da unidade exatamente como aparece.
- Extraia composição, subtipo, finalidade, áreas útil/total, valores de venda/locação, IPTU, condomínio e condições de pagamento quando explícitos.
- Nas condições, preserve quantidades e valores de entrada, parcelas mensais/trimestrais/semestrais/anuais, chaves, saldo, financiamento e índices.
- Extraia endereço detalhado, registro de incorporação, características, acabamentos, ocupação, temporada e dados documentais quando constarem.
- Extraia dados do proprietário apenas quando aparecem no próprio documento; não confunda proprietário com construtora/incorporadora.
- Não retorne CPF, CNPJ ou documento pessoal em dados_extras; use identificador_externo somente se o documento o apresentar claramente como referência não sensível.
- Use datas no formato YYYY-MM-DD quando o dia estiver explícito; caso contrário, use null.
- Coloque observações e informações não mapeadas em dados_extras, sem duplicar campos.
- Se o documento não for uma tabela de unidades, retorne unidades como array vazio.
`.trim();
