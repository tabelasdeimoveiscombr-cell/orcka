import {
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
  type DeleteObjectsCommandInput,
} from "@aws-sdk/client-s3";
import { env } from "../config/env.js";

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

export async function putR2Object(input: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  await r2.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
}

export async function deleteR2Objects(keys: string[]): Promise<void> {
  for (let index = 0; index < keys.length; index += 1000) {
    const batch = keys.slice(index, index + 1000);
    if (batch.length === 0) continue;
    const input: DeleteObjectsCommandInput = {
      Bucket: env.R2_BUCKET,
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    };
    const result = await r2.send(new DeleteObjectsCommand(input));
    if (result.Errors?.length) {
      throw new Error(
        `R2 não conseguiu remover ${result.Errors.length} objeto(s).`,
      );
    }
  }
}
