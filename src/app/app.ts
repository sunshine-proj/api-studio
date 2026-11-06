import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SettingsStore } from '@core/services/settings-store.service';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
})
export class App {
  private readonly settings = inject(SettingsStore);

  constructor() {
    // Applies the saved theme. "system" removes the override so the OS preference decides.
    effect(() => {
      const theme = this.settings.theme();
      const root = document.documentElement;
      if (theme === 'system') delete root.dataset['theme'];
      else root.dataset['theme'] = theme;
    });
  }
}
