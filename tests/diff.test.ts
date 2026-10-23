import { describe, expect, it } from "vitest";
import { calculateInventoryDiff } from "../src/sync/diff.js";
import type { DriveInventoryEntry } from "../src/drive/inventory.js";
import type {
  PreviousDriveFile,
  PreviousDriveFolder,
} from "../src/sync/diff.js";

function entry(
  overrides: Partial<DriveInventoryEntry> = {},
): DriveInventoryEntry {
  return {
    driveFileId: "file-1",
    effectiveDriveFileId: "file-1",
    name: "Tabela.pdf",
    mimeType: "application/pdf",
    parentId: "project-1",
    path: "/Construtora/Projeto/Tabela.pdf",
    depth: 3,
    kind: "file",
    companyDriveId: "company-1",
    projectDriveId: "project-1",
    md5: "hash-1",
    modifiedTime: "2026-10-23T10:00:00Z",
    version: "1",
    size: 100,
    ...overrides,
  };
}

function previousFile(
  overrides: Partial<PreviousDriveFile> = {},
): PreviousDriveFile {
  return {
    drive_file_id: "file-1",
    nome: "Tabela.pdf",
    mime_type: "application/pdf",
    parent_id: "project-1",
    caminho: "/Construtora/Projeto/Tabela.pdf",
    md5: "hash-1",
    modified_time: "2026-10-23T10:00:00Z",
    version: "1",
    tamanho: 100,
    status: "processado",
    deleted_at: null,
    ...overrides,
  };
}

const currentFolders = [
  {
    ...entry({ driveFileId: "company-1", kind: "folder", depth: 1 }),
  },
  {
    ...entry({ driveFileId: "project-1", kind: "folder", depth: 2 }),
  },
] as DriveInventoryEntry[];

describe("calculateInventoryDiff", () => {
  it("classifies new, changed, and unchanged files", () => {
    const diff = calculateInventoryDiff(
      [
        ...currentFolders,
        entry({ driveFileId: "new-file" }),
        entry({ md5: "changed-hash" }),
      ],
      [previousFile()],
      [
        { drive_folder_id: "company-1", depth: 1 },
        { drive_folder_id: "project-1", depth: 2 },
      ],
    );

    expect(diff.created.map((file) => file.driveFileId)).toEqual(["new-file"]);
    expect(diff.updated.map((file) => file.driveFileId)).toEqual(["file-1"]);
    expect(diff.unchanged).toHaveLength(0);
    expect(diff.safeToRemove).toBe(true);
  });

  it("blocks every removal when inventory is incomplete or below 70%", () => {
    const folders: PreviousDriveFolder[] = [
      { drive_folder_id: "company-1", depth: 1 },
    ];
    const files = Array.from({ length: 10 }, (_, index) =>
      previousFile({ drive_file_id: `old-${index}` }),
    );
    const sparseInventory = calculateInventoryDiff(
      [entry()],
      files,
      folders,
    );
    const partialInventory = calculateInventoryDiff(
      [],
      files,
      folders,
      { complete: false },
    );

    expect(sparseInventory.safeToRemove).toBe(false);
    expect(sparseInventory.removedFiles).toHaveLength(0);
    expect(sparseInventory.removedFolders).toHaveLength(0);
    expect(partialInventory.safeToRemove).toBe(false);
    expect(partialInventory.removedFiles).toHaveLength(0);
  });

  it("detects missing files and folders when the inventory is safe", () => {
    const diff = calculateInventoryDiff(
      [
        ...currentFolders,
        entry(),
        ...Array.from({ length: 8 }, (_, index) =>
          entry({ driveFileId: `old-${index}` }),
        ),
      ],
      [
        previousFile(),
        previousFile({ drive_file_id: "removed-file" }),
        ...Array.from({ length: 8 }, (_, index) =>
          previousFile({ drive_file_id: `old-${index}` }),
        ),
      ],
      [
        { drive_folder_id: "company-1", depth: 1 },
        { drive_folder_id: "missing-project", depth: 2 },
      ],
    );

    expect(diff.removedFiles.map((file) => file.drive_file_id)).toEqual([
      "removed-file",
    ]);
    expect(diff.removedFolders.map((folder) => folder.drive_folder_id)).toEqual([
      "missing-project",
    ]);
  });
});