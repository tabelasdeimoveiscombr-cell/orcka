# Instruções do Copilot para Orcka

- Trabalhe somente no worker de captação e sincronização do Google Drive. Não crie painéis, portal público ou site de divulgação.
- Execute uma fase por vez, valide-a e pare para revisão antes de avançar.
- Use TypeScript, Node.js 22, pnpm e as bibliotecas definidas no prompt inicial do projeto.
- Mantenha a sincronização idempotente; falhas no inventário nunca podem provocar remoções. Preserve dados removidos com soft delete e respeite a trava de segurança de 70%.
- Valide entradas externas com Zod, limite concorrência, isole falhas por arquivo e não invente dados extraídos.
- Use a service role do Supabase somente no worker. Fotos e PDFs ficam no Cloudflare R2, nunca no Storage do Supabase.
- Nunca inclua credenciais reais em código, commits ou logs. Não registre conteúdo de variáveis secretas.
- Prefira alterações pequenas, testes focados e os padrões existentes. Não implemente fases futuras antes da aprovação da fase atual.
