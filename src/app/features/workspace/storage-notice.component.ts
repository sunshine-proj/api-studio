import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { SettingsStore } from '@core/services/settings-store.service';
import { StorageHealth } from '@core/services/storage-health.service';
import { StoragePersistence } from '@core/services/storage-persistence.service';

/**
 * Banners about browser storage: failures to load or save, the first-run notice
 * that data is stored unencrypted, and whether the browser may delete the data.
 */
@Component({
  selector: 'app-storage-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton],
  template: `
    @if (health.problems().length > 0) {
      <div class="banner problem" role="alert">
        <div>
          @for (message of health.problems(); track message) {
            <p>{{ message }}</p>
          }
        </div>
        <button mat-button type="button" (click)="health.clear()">Dismiss</button>
      </div>
    }

    @if (settings.loaded()) {
      @if (!settings.settings().storageNoticeAcknowledged) {
        <div class="banner" role="region" aria-label="Storage notice">
          <p>
            API Studio saves your requests, environments and settings in this browser, <strong>unencrypted</strong>.
            Anyone with access to this browser profile can read them, so do not keep production secrets here.
          </p>
          <button mat-flat-button type="button" (click)="acknowledge()">Got it</button>
        </div>
      } @else if (persistence.status() === 'best-effort' && !hidePersistenceHint()) {
        <div class="banner" role="status">
          <p>The browser has not promised to keep this data and may delete it when storage runs low.</p>
          <span class="actions">
            <button mat-stroked-button type="button" (click)="protect()">Ask the browser to keep it</button>
            <button mat-button type="button" (click)="hidePersistenceHint.set(true)">Dismiss</button>
          </span>
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 6px 16px;
      color: var(--mat-sys-on-secondary-container);
      background: var(--mat-sys-secondary-container);
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .problem {
      color: var(--mat-sys-on-error-container);
      background: var(--mat-sys-error-container);
    }
    p {
      margin: 2px 0;
    }
    .actions {
      display: flex;
      flex: 0 0 auto;
      gap: 8px;
    }
  `,
})
export class StorageNoticeComponent {
  protected readonly health = inject(StorageHealth);
  protected readonly settings = inject(SettingsStore);
  protected readonly persistence = inject(StoragePersistence);
  /** Hidden for this visit only; the hint returns next time while the data is not protected. */
  protected readonly hidePersistenceHint = signal(false);

  constructor() {
    void this.persistence.check();
  }

  /** Acknowledging is a user action, so this is also the moment to ask the browser for persistent storage. */
  protected async acknowledge(): Promise<void> {
    const persisting = this.persistence.request();
    await this.settings.update({ storageNoticeAcknowledged: true });
    await persisting;
  }

  protected async protect(): Promise<void> {
    if (await this.persistence.request()) this.hidePersistenceHint.set(true);
  }
}
