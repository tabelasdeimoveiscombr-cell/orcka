# Orcka Drive Worker

Worker TypeScript para inventariar pastas compartilhadas do Google Drive, extrair dados de empreendimentos e unidades, guardar mídia no Cloudflare R2 e sincronizar metadados no Supabase. Não contém painel administrativo, portal público ou site.

O modelo prioriza os dados das tabelas de construtoras/incorporadoras e as características observadas nas referências de engenharia reversa. Dados de contato dos proprietários ficam em `proprietarios`, tabela privada sem política de leitura pública.

## Pré-requisitos

- Node.js 22 e pnpm 10.
- Projeto Supabase com acesso ao SQL Editor.
- Projeto Google Cloud com Drive API v3 habilitada e service account.
- Bucket Cloudflare R2 e credenciais S3 do bucket.
- Chave da API Gemini.

## Configuração dos serviços

### Google Drive

1. Ative a Google Drive API no projeto Google Cloud e crie uma service account.
2. Gere a chave JSON e guarde seu conteúdo como secret `GOOGLE_SERVICE_ACCOUNT_JSON`. O worker aceita JSON puro ou JSON codificado em base64.
3. Compartilhe a pasta raiz do Drive com o `client_email` da service account como leitor.
4. Cadastre o ID da pasta raiz em `DRIVE_ROOT_FOLDER_ID`.

A árvore esperada tem construtoras no primeiro nível e empreendimentos no segundo. O inventário segue níveis inferiores, atalhos e paginação; itens na lixeira são ignorados. Docs são exportados como texto e Sheets como CSV.

### Supabase

1. Crie um projeto e copie a URL e a chave `service_role`.
2. No SQL Editor do Supabase, execute em ordem os arquivos `supabase/migrations/202610230001_initial_schema.sql` e `supabase/migrations/202610230002_property_reference_fields.sql`.
3. Cadastre `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` como secrets. A chave service role é usada somente pelos jobs deste worker.

RLS fica ativo em todas as tabelas. As políticas públicas de leitura filtram soft deletes em construtoras, empreendimentos, unidades e mídias. Proprietários, arquivos de controle e execuções não têm leitura pública.

### Cloudflare R2

1. Crie o bucket `orcka-media` (ou defina outro nome em `R2_BUCKET`).
2. Gere uma chave S3 com permissão de leitura/escrita/remoção nesse bucket.
3. Cadastre `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` e, opcionalmente, `R2_PUBLIC_BASE_URL`.

Fotos são convertidas em WebP até 1600 px e miniaturas até 400 px. PDFs e imagens usam chaves estáveis em `empreendimentos/{id}/`. Objetos só são apagados pelo job de limpeza após 30 dias em soft delete.

### Gemini

Crie uma chave no Google AI Studio e cadastre `GEMINI_API_KEY`. O modelo padrão é `gemini-flash-latest`; pode ser substituído em `GEMINI_MODEL`. A saída JSON é validada por Zod e valores ausentes permanecem nulos, sem inferências.

## Secrets e variáveis

Copie `.env.example` para `.env` no desenvolvimento local. Não versione `.env` nem imprima valores de secrets.

No Codespaces, cadastre credenciais em **Settings → Secrets and variables → Codespaces** na conta, organização ou repositório e reinicie o Codespace. No GitHub Actions, cadastre os mesmos secrets em **Settings → Secrets and variables → Actions**.

Secrets necessários:

- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `DRIVE_ROOT_FOLDER_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `GEMINI_API_KEY`
- `REBUILD_WEBHOOK_URL` (opcional)

Variáveis com defaults disponíveis: `R2_BUCKET`, `R2_PUBLIC_BASE_URL`, `GEMINI_MODEL` e `MAX_PDFS_PER_RUN` (padrão 15).

## Execução local

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm sync:dry
```

O `dry-run` faz o inventário e compara com o snapshot no Supabase, mas não grava no banco, não envia arquivos ao R2 e não chama o Gemini. A primeira execução precisa encontrar o projeto Supabase já migrado e acessível.

Para limitar a execução a uma pasta de construtora ou empreendimento:

```sh
pnpm sync -- --only=DRIVE_FOLDER_ID
pnpm sync:dry -- --only=DRIVE_FOLDER_ID
```

Execução real:

```sh
pnpm sync
```

Jobs auxiliares e verificações:

```sh
pnpm keepalive
pnpm cleanup
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

## Segurança e sincronização

- Um inventário incompleto ou menor que 70% do número anterior de arquivos bloqueia remoções e marca a execução como alerta.
- Falhas de um arquivo não interrompem os demais. Após três tentativas, o arquivo fica com status `erro`.
- A execução processa no máximo `MAX_PDFS_PER_RUN` PDFs por vez; excedentes permanecem pendentes.
- Remoções são soft delete. O workflow semanal apaga dados e objetos expirados após 30 dias.
- O webhook opcional `REBUILD_WEBHOOK_URL` é chamado ao final de uma execução real concluída.

## GitHub Actions

- `sync.yml`: segundas e quintas às 09:00 UTC (06:00 em Brasília), além de `workflow_dispatch`. A execução manual aceita `dry_run` e `only`; o padrão manual é dry-run.
- `keepalive.yml`: consulta diária ao Supabase.
- `cleanup.yml`: limpeza semanal de soft deletes vencidos e objetos R2.
- `ci.yml`: formato, lint, typecheck e testes em pushes e pull requests para `main`.

Agendamentos do GitHub Actions podem atrasar em períodos de alta carga. Para executar manualmente, acesse **Actions**, escolha o workflow e use **Run workflow**.

Este repositório não é um site estático nem um Worker Cloudflare. Não use `npx wrangler deploy` para publicar o sync: o comando falha sem um entrypoint `main` ou diretório de assets, e o processamento foi projetado para Node.js 22 no GitHub Actions. Cloudflare é usado aqui para R2; um eventual site/Pages será um projeto separado.
