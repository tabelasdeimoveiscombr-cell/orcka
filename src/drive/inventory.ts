import { z } from "zod";
import type { drive_v3 } from "googleapis";

const shortcutMimeType = "application/vnd.google-apps.shortcut";
const folderMimeType = "application/vnd.google-apps.folder";

const driveFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().default("Sem nome"),
  mimeType: z.string().min(1),
  parents: z.array(z.string()).optional(),
  md5Checksum: z.string().optional(),
  modifiedTime: z.string().datetime({ offset: true }).optional(),
  version: z.string().optional(),
  size: z.string().optional(),
  trashed: z.boolean().optional(),
  shortcutDetails: z
    .object({
      targetId: z.string().min(1),
      targetMimeType: z.string().min(1).optional(),
    })
    .optional(),
});

const driveFileListSchema = z.object({
  files: z.array(driveFileSchema).default([]),
  nextPageToken: z.string().optional(),
});

export interface DriveInventoryEntry {
  driveFileId: string;
  effectiveDriveFileId: string;
  name: string;
  mimeType: string;
  parentId: string;
  path: string;
  depth: number;
  kind: "folder" | "file";
  companyDriveId: string | null;
  projectDriveId: string | null;
  md5: string | null;
  modifiedTime: string | null;
  version: string | null;
  size: number | null;
}

export interface DriveInventory {
  entries: DriveInventoryEntry[];
  completedAt: string;
}

const fileFields =
  "id,name,mimeType,parents,md5Checksum,modifiedTime,version,size,trashed,shortcutDetails";

export async function listDriveInventory(
  drive: drive_v3.Drive,
  rootFolderId: string,
): Promise<DriveInventory> {
  const entries: DriveInventoryEntry[] = [];

  async function listChildren(parentId: string): Promise<z.infer<typeof driveFileSchema>[]> {
    const files: z.infer<typeof driveFileSchema>[] = [];
    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: `'${parentId.replaceAll("'", "\\'")}' in parents and trashed = false`,
        pageSize: 1000,
        pageToken,
        fields: `nextPageToken,files(${fileFields})`,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      const page = driveFileListSchema.parse(response.data);
      files.push(...page.files.filter((file) => !file.trashed));
      pageToken = page.nextPageToken;
    } while (pageToken);

    return files;
  }

  async function resolveShortcut(
    file: z.infer<typeof driveFileSchema>,
  ): Promise<z.infer<typeof driveFileSchema>> {
    if (file.mimeType !== shortcutMimeType) return file;
    if (!file.shortcutDetails?.targetId) {
      throw new Error(`Atalho sem destino: ${file.name} (${file.id})`);
    }
    const response = await drive.files.get({
      fileId: file.shortcutDetails.targetId,
      fields: fileFields,
      supportsAllDrives: true,
    });
    return driveFileSchema.parse({
      ...response.data,
      id: file.id,
      name: file.name,
      parents: file.parents,
      shortcutDetails: file.shortcutDetails,
    });
  }

  async function visit(
    parentId: string,
    parentPath: string,
    depth: number,
    companyDriveId: string | null,
    projectDriveId: string | null,
    ancestry: Set<string>,
  ): Promise<void> {
    const files = await listChildren(parentId);

    for (const listedFile of files) {
      const file = await resolveShortcut(listedFile);
      const isFolder = file.mimeType === folderMimeType;
      const path = `${parentPath}/${listedFile.name}`;
      const entryCompanyId = depth === 1 ? listedFile.id : companyDriveId;
      const entryProjectId = depth === 2 ? listedFile.id : projectDriveId;

      const entry: DriveInventoryEntry = {
        driveFileId: listedFile.id,
        effectiveDriveFileId: file.shortcutDetails?.targetId ?? listedFile.id,
        name: listedFile.name,
        mimeType: file.mimeType,
        parentId,
        path,
        depth,
        kind: isFolder ? "folder" : "file",
        companyDriveId: entryCompanyId,
        projectDriveId: entryProjectId,
        md5: file.md5Checksum ?? null,
        modifiedTime: file.modifiedTime ?? null,
        version: file.version ?? null,
        size: file.size === undefined ? null : Number(file.size),
      };
      if (entry.size !== null && !Number.isFinite(entry.size)) {
        throw new Error(`Tamanho inválido no Drive: ${listedFile.id}`);
      }
      entries.push(entry);

      if (isFolder) {
        const folderTargetId = file.shortcutDetails?.targetId ?? file.id;
        if (ancestry.has(folderTargetId)) {
          throw new Error(`Ciclo detectado na árvore do Drive: ${path}`);
        }
        const childAncestry = new Set(ancestry).add(folderTargetId);
        await visit(
          folderTargetId,
          path,
          depth + 1,
          entryCompanyId,
          entryProjectId,
          childAncestry,
        );
      }
    }
  }

  await visit(rootFolderId, "", 1, null, null, new Set([rootFolderId]));

  return { entries, completedAt: new Date().toISOString() };
}