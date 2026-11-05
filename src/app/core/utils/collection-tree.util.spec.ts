import { Collection, Folder } from '../models';
import { buildCollectionTree, cleanName, folderSubtreeIds, nextSortOrder } from './collection-tree.util';

const collection = (id: string, sortOrder = 0, name = id): Collection => ({
  id, schemaVersion: 1, createdAt: 0, updatedAt: 0, name, description: '', sortOrder,
});
const folder = (id: string, collectionId: string, parentId: string | null, sortOrder = 0): Folder => ({
  id, schemaVersion: 1, createdAt: 0, updatedAt: 0, name: id, collectionId, parentId, sortOrder,
});

describe('collection tree', () => {
  it('nests folders and orders siblings by sortOrder then name', () => {
    const tree = buildCollectionTree(
      [collection('b', 1), collection('a', 0)],
      [folder('f2', 'a', null, 1), folder('f1', 'a', null, 0), folder('child', 'a', 'f1'), folder('other', 'b', null)],
    );
    expect(tree.map((n) => n.collection.id)).toEqual(['a', 'b']);
    expect(tree[0].folders.map((n) => n.folder.id)).toEqual(['f1', 'f2']);
    expect(tree[0].folders[0].children.map((n) => n.folder.id)).toEqual(['child']);
    expect(tree[1].folders.map((n) => n.folder.id)).toEqual(['other']);
  });

  it('leaves out orphaned folders and parent cycles instead of looping', () => {
    const tree = buildCollectionTree(
      [collection('a')],
      [folder('orphan', 'a', 'missing'), folder('x', 'a', 'y'), folder('y', 'a', 'x'), folder('ok', 'a', null)],
    );
    expect(tree[0].folders.map((n) => n.folder.id)).toEqual(['ok']);
  });

  it('collects a folder subtree', () => {
    const folders = [folder('a', 'c', null), folder('b', 'c', 'a'), folder('c2', 'c', 'b'), folder('z', 'c', null)];
    expect([...folderSubtreeIds(folders, 'a')].sort()).toEqual(['a', 'b', 'c2']);
    expect(folderSubtreeIds(folders, 'z')).toEqual(['z']);
  });

  it('computes the next sort order and cleans names', () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([{ sortOrder: 4 }, { sortOrder: 1 }])).toBe(5);
    expect(cleanName('  My API  ', 'x')).toBe('My API');
    expect(cleanName('   ', 'Fallback')).toBe('Fallback');
    expect(cleanName('a'.repeat(500), 'x')).toHaveLength(120);
  });
});
