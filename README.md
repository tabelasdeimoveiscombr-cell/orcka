# Orcka

Plataforma imobiliária. Este repositório contém o worker de captação e sincronização de dados do Google Drive.

## Desenvolvimento local

Requer Node.js 22 e pnpm. Instale as dependências e crie seu arquivo local de configuração:

```sh
pnpm install
cp .env.example .env
```

Preencha `.env` com credenciais de desenvolvimento. Nunca versione esse arquivo nem inclua valores reais de secrets no código, em commits ou nos logs.

Para usar os comandos locais no GitHub Codespaces, cadastre os valores em **Settings → Secrets and variables → Codespaces** no repositório ou na organização e recrie o Codespace para disponibilizá-los. Para execuções do GitHub Actions, cadastre-os em **Settings → Secrets and variables → Actions**. Os nomes correspondem às variáveis listadas em `.env.example`.

## Comandos

- `pnpm sync` executará a sincronização quando o worker for implementado.
- `pnpm sync:dry` executará a sincronização em modo de simulação.
- `pnpm keepalive` e `pnpm cleanup` executam os jobs correspondentes.
- `pnpm typecheck`, `pnpm lint` e `pnpm test` verificam o projeto.
