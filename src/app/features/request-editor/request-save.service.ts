import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { RequestSession } from '@core/services/request-session.service';
import { RequestTab } from '@core/services/request-tab';
import { SavedRequestStore } from '@core/services/saved-request-store.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '@shared/components/dialogs/confirm-dialog.component';
import {
  LocationDialogComponent,
  LocationDialogData,
  LocationDialogResult,
} from '@shared/components/dialogs/location-dialog.component';

/** Dialog flows around saving and closing request tabs. The saving itself is done by `RequestSession`. */
@Injectable({ providedIn: 'root' })
export class RequestSaveFlow {
  private readonly session = inject(RequestSession);
  private readonly saved = inject(SavedRequestStore);
  private readonly dialog = inject(MatDialog);

  /** Saves the tab in place, or asks where to save it when it is not stored yet. */
  async save(tab: RequestTab): Promise<void> {
    if ((await this.session.save(tab.id)) === 'needs-location') {
      await this.saveAs(tab);
    }
  }

  /** Asks for a name and place, then stores the tab as a new request. */
  async saveAs(tab: RequestTab): Promise<void> {
    const current = tab.saved();
    const result = await firstValueFrom(
      this.dialog
        .open<LocationDialogComponent, LocationDialogData, LocationDialogResult>(LocationDialogComponent, {
          data: {
            title: current ? 'Save as a new request' : 'Save request',
            confirmLabel: 'Save',
            tree: this.saved.tree(),
            name: tab.title(),
            collectionId: current?.collectionId,
            folderId: current?.folderId ?? null,
            allowNewCollection: true,
          },
        })
        .afterClosed(),
    );
    if (!result) return;
    await this.session.saveAs(tab.id, {
      name: result.name,
      collectionId: result.collectionId,
      newCollectionName: result.newCollectionName,
      folderId: result.folderId,
    });
  }

  /** Closes the tab, first asking when it has unsaved changes. */
  async close(tab: RequestTab): Promise<void> {
    if (tab.dirty()) {
      const data: ConfirmDialogData = {
        title: 'Close without saving?',
        message: `"${tab.title()}" has unsaved changes. They will be lost if you close it.`,
        confirmLabel: 'Close without saving',
      };
      const confirmed = await firstValueFrom(
        this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, { data }).afterClosed(),
      );
      if (confirmed !== true) return;
    }
    this.session.closeTab(tab.id);
  }
}
