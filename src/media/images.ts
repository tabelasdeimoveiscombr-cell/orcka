import sharp from "sharp";

type PutObject = (input: {
  key: string;
  body: Buffer;
  contentType: string;
}) => Promise<void>;

const putObject: PutObject = async (input) => {
  const storage = await import("../storage/r2.js");
  await storage.putR2Object(input);
};

export interface ProcessedImage {
  key: string;
  thumbnailKey: string;
  width: number;
  height: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
}

export async function processAndStoreImage(
  buffer: Buffer,
  projectId: string,
  driveFileId: string,
  upload: PutObject = putObject,
): Promise<ProcessedImage> {
  const maxInputPixels = 80_000_000;
  const image = sharp(buffer, { limitInputPixels: maxInputPixels }).rotate();
  const [
    { data: imageBuffer, info: imageInfo },
    { data: thumbnailBuffer, info: thumbnailInfo },
  ] = await Promise.all([
    image
      .clone()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true }),
    image
      .clone()
      .resize({
        width: 400,
        height: 400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 76 })
      .toBuffer({ resolveWithObject: true }),
  ]);
  const key = `empreendimentos/${projectId}/${driveFileId}.webp`;
  const thumbnailKey = `empreendimentos/${projectId}/thumbs/${driveFileId}.webp`;

  await Promise.all([
    upload({ key, body: imageBuffer, contentType: "image/webp" }),
    upload({
      key: thumbnailKey,
      body: thumbnailBuffer,
      contentType: "image/webp",
    }),
  ]);

  return {
    key,
    thumbnailKey,
    width: imageInfo.width,
    height: imageInfo.height,
    thumbnailWidth: thumbnailInfo.width,
    thumbnailHeight: thumbnailInfo.height,
  };
}

export async function storePdf(
  buffer: Buffer,
  projectId: string,
  driveFileId: string,
  upload: PutObject = putObject,
): Promise<string> {
  const key = `empreendimentos/${projectId}/${driveFileId}.pdf`;
  await upload({ key, body: buffer, contentType: "application/pdf" });
  return key;
}
