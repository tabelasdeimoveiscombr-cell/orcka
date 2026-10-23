import type { drive_v3 } from "googleapis";

const googleDocMimeType = "application/vnd.google-apps.document";
const googleSheetMimeType = "application/vnd.google-apps.spreadsheet";

async function toBuffer(value: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value
  ) {
    const chunks: Buffer[] = [];
    for await (const chunk of value as AsyncIterable<
      Buffer | Uint8Array | string
    >) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("O Drive retornou um formato de arquivo não suportado.");
}

export async function downloadDriveFile(
  drive: drive_v3.Drive,
  fileId: string,
  mimeType: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  if (mimeType === googleDocMimeType || mimeType === googleSheetMimeType) {
    const exportMimeType =
      mimeType === googleDocMimeType ? "text/plain" : "text/csv";
    const response = await drive.files.export(
      { fileId, mimeType: exportMimeType },
      { responseType: "arraybuffer" },
    );
    return {
      buffer: await toBuffer(response.data),
      contentType: exportMimeType,
    };
  }

  const response = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return {
    buffer: await toBuffer(response.data),
    contentType: mimeType,
  };
}
