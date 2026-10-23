import { describe, expect, it, vi } from "vitest";
import type { drive_v3 } from "googleapis";
import { listDriveInventory } from "../src/drive/inventory.js";

describe("listDriveInventory", () => {
  it("paginates, follows shortcuts, and assigns project paths", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          files: [
            {
              id: "builder",
              name: "Construtora",
              mimeType: "application/vnd.google-apps.folder",
            },
          ],
          nextPageToken: "next",
        },
      })
      .mockResolvedValueOnce({
        data: {
          files: [],
        },
      })
      .mockResolvedValueOnce({
        data: {
          files: [
            {
              id: "project",
              name: "Residencial",
              mimeType: "application/vnd.google-apps.folder",
            },
            {
              id: "ignored-trash",
              name: "Lixeira",
              mimeType: "application/pdf",
              trashed: true,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          files: [
            {
              id: "shortcut",
              name: "Tabela.pdf",
              mimeType: "application/vnd.google-apps.shortcut",
              shortcutDetails: {
                targetId: "target-pdf",
                targetMimeType: "application/pdf",
              },
            },
          ],
        },
      });
    const get = vi.fn().mockResolvedValue({
      data: {
        id: "target-pdf",
        name: "Original.pdf",
        mimeType: "application/pdf",
        md5Checksum: "checksum",
        size: "123",
        version: "2",
      },
    });
    const drive = {
      files: { list, get },
    } as unknown as drive_v3.Drive;

    const inventory = await listDriveInventory(drive, "root");

    expect(list).toHaveBeenCalledTimes(4);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "target-pdf" }),
    );
    expect(inventory.entries.map((entry) => entry.driveFileId)).toEqual([
      "builder",
      "project",
      "shortcut",
    ]);
    expect(inventory.entries[2]).toMatchObject({
      effectiveDriveFileId: "target-pdf",
      mimeType: "application/pdf",
      companyDriveId: "builder",
      projectDriveId: "project",
      size: 123,
      path: "/Construtora/Residencial/Tabela.pdf",
    });
  });

  it("rejects a failed page instead of returning a partial inventory", async () => {
    const drive = {
      files: {
        list: vi.fn().mockRejectedValue(new Error("Drive unavailable")),
      },
    } as unknown as drive_v3.Drive;

    await expect(listDriveInventory(drive, "root")).rejects.toThrow(
      "Drive unavailable",
    );
  });
});
