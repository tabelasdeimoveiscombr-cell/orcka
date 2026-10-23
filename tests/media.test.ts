import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { processAndStoreImage } from "../src/media/images.js";

describe("processAndStoreImage", () => {
  it("stores WebP image variants with stable keys and bounded dimensions", async () => {
    const source = await sharp({
      create: {
        width: 1800,
        height: 1200,
        channels: 3,
        background: { r: 230, g: 80, b: 40 },
      },
    })
      .png()
      .toBuffer();
    const upload = vi.fn().mockResolvedValue(undefined);

    const result = await processAndStoreImage(source, "project-id", "drive-id", upload);

    expect(result).toMatchObject({
      key: "empreendimentos/project-id/drive-id.webp",
      thumbnailKey: "empreendimentos/project-id/thumbs/drive-id.webp",
      width: 1600,
      height: 1067,
      thumbnailWidth: 400,
      thumbnailHeight: 267,
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "image/webp" }),
    );
  });
});