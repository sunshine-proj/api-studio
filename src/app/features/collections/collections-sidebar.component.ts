import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenu, MatMenuContent, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { firstValueFrom } from 'rxjs';
import { CollectionStore } from '@core/services/collection-store.service';
import { folderSubtreeIds } from '@core/utils/collection-tree.util';
import { ConfirmDialogComponent, ConfirmDialogData } from '@shared/components/dialogs/confirm-dialog.component';
import { NameDialogComponent, NameDialogData } from '@shared/components/dialogs/name-dialog.component';

type NodeKind = 'collection' | 'folder';

@Component({
  selector: 'app-collections-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatMenu, MatMenuContent, MatMenuItem, MatMenuTrigger, NgTemplateOutlet],
  templateUrl: './collections-sidebar.component.html',
  styleUrl: './collections-sidebar.component.scss',
})
export class CollectionsSidebarComponent {
  protected readonly store = inject(CollectionStore);
  private readonly dialog = inject(MatDialog);

  /** Which collections and folders are open. Purely view state, so it is not persisted. */
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());

  protected toggle(id: string): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  private expand(...ids: (string | null)[]): void {
    this.expanded.update((set) => new Set([...set, ...ids.filter((id): id is string => id !== null)]));
  }

  protected async newCollection(): Promise<void> {
    const name = await this.askName({ title: 'New collection', label: 'Collection name', confirmLabel: 'Create' });
    if (name === undefined) return;
    const collection = await this.store.createCollection(name);
    if (collection) this.expand(collection.id);
  }

  protected async newFolder(collectionId: string, parentId: string | null): Promise<void> {
    const name = await this.askName({ title: 'New folder', label: 'Folder name', confirmLabel: 'Create' });
    if (name === undefined) return;
    const folder = await this.store.createFolder(collectionId, parentId, name);
    if (folder) this.expand(collectionId, parentId);
  }

  protected async rename(kind: NodeKind, id: string, current: string): Promise<void> {
    const name = await this.askName({
      title: kind === 'collection' ? 'Rename collection' : 'Rename folder',
      label: 'Name',
      confirmLabel: 'Rename',
      value: current,
    });
    if (name === undefined) return;
    await (kind === 'collection' ? this.store.renameCollection(id, name) : this.store.renameFolder(id, name));
  }

  protected async remove(kind: NodeKind, id: string, name: string): Promise<void> {
    const folders = this.store.folders();
    const count =
      kind === 'collection'
        ? folders.filter((folder) => folder.collectionId === id).length
        : folderSubtreeIds(folders, id).length - 1;
    const contents = count === 0 ? '' : ` and the ${count} folder${count === 1 ? '' : 's'} inside it`;
    const confirmed = await this.confirm({
      title: kind === 'collection' ? 'Delete collection?' : 'Delete folder?',
      message: `"${name}"${contents} will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    await (kind === 'collection' ? this.store.deleteCollection(id) : this.store.deleteFolder(id));
  }

  private askName(data: NameDialogData): Promise<string | undefined> {
    return firstValueFrom(this.dialog.open<NameDialogComponent, NameDialogData, string>(NameDialogComponent, { data }).afterClosed());
  }

  private async confirm(data: ConfirmDialogData): Promise<boolean> {
    const result = await firstValueFrom(
      this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, { data }).afterClosed(),
    );
    return result === true;
  }
}
