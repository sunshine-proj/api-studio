import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ThemePreference } from '@core/models';
import { SettingsStore } from '@core/services/settings-store.service';

const OPTIONS: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Light, dark or system theme. The choice is saved with the settings. */
@Component({
  selector: 'app-theme-selector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label for="theme">Theme</label>
    <select id="theme" (change)="choose($any($event.target).value)">
      @for (option of options; track option.value) {
        <option [value]="option.value" [selected]="option.value === settings.theme()">{{ option.label }}</option>
      }
    </select>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    select {
      height: 32px;
      padding: 0 8px;
      font: inherit;
      color: inherit;
      background: var(--mat-sys-surface);
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
    }
  `,
})
export class ThemeSelectorComponent {
  protected readonly settings = inject(SettingsStore);
  protected readonly options = OPTIONS;

  protected choose(value: string): void {
    const option = OPTIONS.find((o) => o.value === value);
    if (option) void this.settings.update({ theme: option.value });
  }
}
