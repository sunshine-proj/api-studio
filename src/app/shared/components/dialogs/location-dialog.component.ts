import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { CollectionNode, flattenFolders } from '@core/utils/collection-tree.util';

export interface LocationDialogData {
  readonly title: string;
  readonly confirmLabel: string;
  readonly tree: readonly CollectionNode[];
  /** When set, a name field is shown with this initial text. */
  readonly name?: string;
  /** Preselected place. */
  readonly collectionId?: string;
  readonly folderId?: string | null;
  /** Offers creating a new collection (needed when none exists yet). */
  readonly allowNewCollection: boolean;
}

export interface LocationDialogResult {
  /** Empty when the dialog has no name field. */
  readonly name: string;
  /** Null when `newCollectionName` is set instead. */
  readonly collectionId: string | null;
  readonly newCollectionName: string | null;
  readonly folderId: string | null;
}

const NEW_COLLECTION = '__new__';
const NBSP = ' ';

/** Picks a collection and folder (and optionally a name). Closes with the choice, or undefined when cancelled. */
@Component({
  selector: 'app-location-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <form (submit)="submit($event)">
      <mat-dialog-content>
        @if (data.name !== undefined) {
          <label class="field">
            Name
            <input name="name" maxlength="120" autocomplete="off" [value]="data.name" (focus)="$any($event.target).select()" />
          </label>
        }

        <label class="field">
          Collection
          <select [value]="collectionChoice()" (change)="chooseCollection($any($event.target).value)">
            @for (node of data.tree; track node.collection.id) {
              <option [value]="node.collection.id" [selected]="node.collection.id === collectionChoice()">
                {{ node.collection.name }}
              </option>
            }
            @if (data.allowNewCollection) {
              <option [value]="newCollectionValue" [selected]="collectionChoice() === newCollectionValue">New collection…</option>
            }
          </select>
        </label>

        @if (creatingCollection()) {
          <label class="field">
            New collection name
            <input name="newName" maxlength="120" autocomplete="off" [attr.aria-invalid]="invalid()" (input)="invalid.set(false)" />
          </label>
        } @else {
          <label class="field">
            Folder
            <select [value]="folderChoice() ?? ''" (change)="folderChoice.set($any($event.target).value || null)">
              <option value="" [selected]="folderChoice() === null">(Collection root)</option>
              @for (folder of folders(); track folder.id) {
                <option [value]="folder.id" [selected]="folder.id === folderChoice()">{{ indent(folder.depth) }}{{ folder.name }}</option>
              }
            </select>
          </label>
        }
        <p class="error" role="alert">{{ invalid() ? 'Enter a name for the new collection.' : '' }}</p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="!hasTarget()">{{ data.confirmLabel }}</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-dialog-content {
      min-width: 360px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 12px;
    }
    input,
    select {
      height: 34px;
      padding: 0 8px;
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 4px;
    }
    option {
      color: initial;
    }
    .error {
      min-height: 1.2em;
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class LocationDialogComponent {
  protected readonly data = inject<LocationDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<LocationDialogComponent, LocationDialogResult>>(MatDialogRef);

  protected readonly newCollectionValue = NEW_COLLECTION;
  protected readonly collectionChoice = signal(this.initialCollection());
  protected readonly folderChoice = signal<string | null>(this.data.folderId ?? null);
  protected readonly invalid = signal(false);

  protected readonly creatingCollection = computed(() => this.collectionChoice() === NEW_COLLECTION);
  protected readonly hasTarget = computed(() => this.collectionChoice() !== '');
  protected readonly folders = computed(() => {
    const node = this.data.tree.find((n) => n.collection.id === this.collectionChoice());
    return node ? flattenFolders(node.folders) : [];
  });

  protected indent(depth: number): string {
    return NBSP.repeat(depth * 3);
  }

  protected chooseCollection(value: string): void {
    this.collectionChoice.set(value);
    this.folderChoice.set(null);
    this.invalid.set(false);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    const name = String(form.get('name') ?? '');
    const newCollectionName = String(form.get('newName') ?? '');
    const choice = this.collectionChoice();
    if (choice === '') return;
    if (choice === NEW_COLLECTION) {
      if (newCollectionName.trim() === '') {
        this.invalid.set(true);
        return;
      }
      this.ref.close({ name: name.trim(), collectionId: null, newCollectionName: newCollectionName.trim(), folderId: null });
      return;
    }
    this.ref.close({ name: name.trim(), collectionId: choice, newCollectionName: null, folderId: this.folderChoice() });
  }

  private initialCollection(): string {
    const { tree, collectionId, allowNewCollection } = this.data;
    if (collectionId !== undefined && tree.some((n) => n.collection.id === collectionId)) return collectionId;
    if (tree.length > 0) return tree[0].collection.id;
    return allowNewCollection ? NEW_COLLECTION : '';
  }
}
