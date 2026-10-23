import type { DriveInventoryEntry } from "../drive/inventory.js";

export interface PreviousDriveFile {
  drive_file_id: string;
  nome: string;
  mime_type: string;
  parent_id: string | null;
  caminho: string;
  md5: string | null;
  modified_time: string | null;
  version: string | null;
  tamanho: number | null;
  status: string;
  deleted_at?: string | null;
}

export interface PreviousDriveFolder {
  drive_folder_id: string;
  depth: 1 | 2;
}

export interface InventoryDiff {
  created: DriveInventoryEntry[];
  updated: DriveInventoryEntry[];
  unchanged: DriveInventoryEntry[];
  removedFiles: PreviousDriveFile[];
  removedFolders: PreviousDriveFolder[];
  safeToRemove: boolean;
  alertReason: string | null;
}

function sameFileMetadata(
  entry: DriveInventoryEntry,
  previous: PreviousDriveFile,
): boolean {
  return (
    entry.name === previous.nome &&
    entry.mimeType === previous.mime_type &&
    entry.parentId === previous.parent_id &&
    entry.path === previous.caminho &&
    entry.md5 === previous.md5 &&
    entry.modifiedTime === previous.modified_time &&
    entry.version === previous.version &&
    entry.size === previous.tamanho &&
    previous.status !== "removido" &&
    !previous.deleted_at
  );
}

export function calculateInventoryDiff(
  entries: DriveInventoryEntry[],
  previousFiles: PreviousDriveFile[],
  previousFolders: PreviousDriveFolder[],
  options: { complete: boolean; only?: string } = { complete: true },
): InventoryDiff {
  const inScope = (entry: DriveInventoryEntry): boolean =>
    !options.only ||
    entry.driveFileId === options.only ||
    entry.companyDriveId === options.only ||
    entry.projectDriveId === options.only;
  const currentEntries = entries.filter(inScope);
  const currentFiles = currentEntries.filter(
    (entry) => entry.kind === "file" && entry.projectDriveId !== null,
  );
  const currentFolders = currentEntries.filter(
    (entry) => entry.kind === "folder" && (entry.depth === 1 || entry.depth === 2),
  );
  const currentFilesById = new Map(
    currentFiles.map((entry) => [entry.driveFileId, entry]),
  );
  const previousFilesById = new Map(
    previousFiles.map((file) => [file.drive_file_id, file]),
  );
  const previousFoldersById = new Map(
    previousFolders.map((folder) => [folder.drive_folder_id, folder]),
  );
  const currentFolderIds = new Set(
    currentFolders.map((folder) => folder.driveFileId),
  );
  const previousFolderCount = previousFiles.length;
  const currentFileCount = currentFiles.length;
  const belowSafetyThreshold =
    previousFolderCount > 0 && currentFileCount / previousFolderCount < 0.7;
  const safeToRemove = options.complete && !belowSafetyThreshold;
  const alertReason = !options.complete
    ? "O inventário do Drive não foi concluído."
    : belowSafetyThreshold
      ? `Inventário contém ${currentFileCount} de ${previousFolderCount} arquivos anteriores (abaixo de 70%).`
      : null;

  const created: DriveInventoryEntry[] = [];
  const updated: DriveInventoryEntry[] = [];
  const unchanged: DriveInventoryEntry[] = [];
  for (const entry of currentFiles) {
    const previous = previousFilesById.get(entry.driveFileId);
    if (!previous) created.push(entry);
    else if (sameFileMetadata(entry, previous)) unchanged.push(entry);
    else updated.push(entry);
  }

  const removedFiles = safeToRemove
    ? previousFiles.filter((file) => !currentFilesById.has(file.drive_file_id))
    : [];
  const removedFolders = safeToRemove
    ? previousFolders.filter(
        (folder) => !currentFolderIds.has(folder.drive_folder_id),
      )
    : [];

  return {
    created,
    updated,
    unchanged,
    removedFiles,
    removedFolders,
    safeToRemove,
    alertReason,
  };
}