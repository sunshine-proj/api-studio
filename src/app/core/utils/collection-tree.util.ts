import { Collection, Folder, SavedRequest } from '../models';

export interface FolderNode {
  readonly folder: Folder;
  readonly children: readonly FolderNode[];
  readonly requests: readonly SavedRequest[];
}

export interface CollectionNode {
  readonly collection: Collection;
  /** Top-level folders of the collection. */
  readonly folders: readonly FolderNode[];
  /** Requests saved directly in the collection, outside any folder. */
  readonly requests: readonly SavedRequest[];
}

const byOrder = <T extends { readonly sortOrder: number; readonly name: string }>(a: T, b: T): number =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/**
 * Nests folders under their collection and parent folder. Folders whose parent
 * or collection is missing, or that sit in a parent cycle, are unreachable from
 * a root and are left out, so corrupt data can never loop the UI.
 */
export function buildCollectionTree(
  collections: readonly Collection[],
  folders: readonly Folder[],
  requests: readonly SavedRequest[] = [],
): readonly CollectionNode[] {
  const children = new Map<string, Folder[]>();
  for (const folder of folders) {
    const key = `${folder.collectionId}/${folder.parentId ?? ''}`;
    children.set(key, [...(children.get(key) ?? []), folder]);
  }

  const requestsIn = (collectionId: string, folderId: string | null): SavedRequest[] =>
    requests
      .filter((request) => request.collectionId === collectionId && request.folderId === folderId)
      .sort(byOrder);

  const build = (collectionId: string, parentId: string | null, seen: ReadonlySet<string>): FolderNode[] =>
    (children.get(`${collectionId}/${parentId ?? ''}`) ?? [])
      .filter((folder) => !seen.has(folder.id))
      .sort(byOrder)
      .map((folder) => ({
        folder,
        children: build(collectionId, folder.id, new Set([...seen, folder.id])),
        requests: requestsIn(collectionId, folder.id),
      }));

  return [...collections]
    .sort(byOrder)
    .map((collection) => ({
      collection,
      folders: build(collection.id, null, new Set()),
      requests: requestsIn(collection.id, null),
    }));
}

/** Ids of a folder and all folders below it. */
export function folderSubtreeIds(folders: readonly Folder[], rootId: string): readonly string[] {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return [...ids];
}

export function nextSortOrder(items: readonly { readonly sortOrder: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
}

const MAX_NAME_LENGTH = 120;

/** Trims and limits a user-entered name, using a fallback for blank input. */
export function cleanName(name: string, fallback: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH) || fallback;
}

export interface FolderOption {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
}

/** Flattens a folder tree depth-first, for pickers that show nesting by indentation. */
export function flattenFolders(nodes: readonly FolderNode[], depth = 0): readonly FolderOption[] {
  return nodes.flatMap((node) => [
    { id: node.folder.id, name: node.folder.name, depth },
    ...flattenFolders(node.children, depth + 1),
  ]);
}

/** Ids of the folders that contain a folder, from the nearest parent up. Stops on cycles. */
export function ancestorFolderIds(folders: readonly Folder[], folderId: string | null): readonly string[] {
  const ids: string[] = [];
  let current = folderId === null ? undefined : folders.find((f) => f.id === folderId);
  while (current && !ids.includes(current.id)) {
    ids.push(current.id);
    current = current.parentId === null ? undefined : folders.find((f) => f.id === current?.parentId);
  }
  return ids;
}

/** The requests of a collection or folder in the order they appear in the sidebar: subfolders first (depth first), then its own requests. */
export function requestsInOrder(node: {
  readonly folders?: readonly FolderNode[];
  readonly children?: readonly FolderNode[];
  readonly requests: readonly SavedRequest[];
}): readonly SavedRequest[] {
  const folders = node.folders ?? node.children ?? [];
  return [...folders.flatMap((folder) => requestsInOrder(folder)), ...node.requests];
}

/** Finds a folder's node anywhere below the given ones. */
export function findFolderNode(nodes: readonly FolderNode[], folderId: string): FolderNode | undefined {
  for (const node of nodes) {
    if (node.folder.id === folderId) return node;
    const inside = findFolderNode(node.children, folderId);
    if (inside) return inside;
  }
  return undefined;
}
