import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { z } from "zod";
import { google } from "googleapis";

const clientFileSchema = z
  .object({
    installed: z
      .object({
        client_id: z.string().min(1),
        client_secret: z.string().min(1),
        redirect_uris: z.array(z.string().url()).min(1),
      })
      .optional(),
    web: z
      .object({
        client_id: z.string().min(1),
        client_secret: z.string().min(1),
        redirect_uris: z.array(z.string().url()).min(1),
      })
      .optional(),
  })
  .refine((credentials) => credentials.installed || credentials.web);

const scope = "https://www.googleapis.com/auth/drive.readonly";

async function readSecretInput(prompt: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Execute este comando em um terminal interativo local.");
  }

  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", handleInput);
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value.trim());
    };
    const handleInput = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          finish(new Error("Autorização cancelada."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    stdin.on("data", handleInput);
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export async function runGoogleAuth(
  clientFilePath = process.argv[2],
): Promise<void> {
  if (!clientFilePath) {
    throw new Error("Uso: pnpm google:auth -- .secrets/oauth-client.json");
  }

  const clientFile = JSON.parse(
    await readFile(clientFilePath, "utf8"),
  ) as unknown;
  const parsed = clientFileSchema.parse(clientFile);
  const credentials = parsed.installed ?? parsed.web;
  if (!credentials)
    throw new Error("Arquivo OAuth sem credenciais de cliente.");

  const redirectUri = credentials.redirect_uris.find((uri) => {
    const parsedUri = new URL(uri);
    return (
      parsedUri.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsedUri.hostname)
    );
  });
  if (!redirectUri) {
    throw new Error(
      "O cliente OAuth precisa permitir redirecionamento loopback localhost.",
    );
  }

  const oauth = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    redirectUri,
  );
  const state = randomBytes(32).toString("hex");
  const authorizationUrl = oauth.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent",
    scope: [scope],
    state,
  });

  console.log(
    "Abra esta URL no navegador e autorize a leitura do Google Drive:",
  );
  console.log(authorizationUrl);
  console.log(
    "Após autorizar, o navegador pode mostrar erro de conexão em localhost. Copie a URL completa da barra de endereço e cole no próximo prompt; não a envie no chat.",
  );
  const callback = await readSecretInput(
    "URL de retorno OAuth (entrada oculta): ",
  );
  const callbackUrl = new URL(callback);
  const returnedState = callbackUrl.searchParams.get("state");
  const code = callbackUrl.searchParams.get("code");
  const oauthError = callbackUrl.searchParams.get("error");

  if (oauthError)
    throw new Error(`Autorização recusada pelo Google: ${oauthError}`);
  if (!returnedState || !constantTimeEqual(state, returnedState) || !code) {
    throw new Error("URL de retorno inválida; estado OAuth não corresponde.");
  }

  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "O Google não retornou refresh token. Revogue o acesso anterior do app e execute novamente.",
    );
  }

  const envFile = [
    `GOOGLE_OAUTH_CLIENT_ID=${JSON.stringify(credentials.client_id)}`,
    `GOOGLE_OAUTH_CLIENT_SECRET=${JSON.stringify(credentials.client_secret)}`,
    `GOOGLE_OAUTH_REFRESH_TOKEN=${JSON.stringify(tokens.refresh_token)}`,
    "",
  ].join("\n");
  await writeFile(".env.oauth", envFile, { encoding: "utf8", mode: 0o600 });
  await chmod(".env.oauth", 0o600);
  console.log("OAuth salvo em .env.oauth (arquivo ignorado pelo Git).");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGoogleAuth().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Falha na autorização OAuth.",
    );
    process.exitCode = 1;
  });
}
