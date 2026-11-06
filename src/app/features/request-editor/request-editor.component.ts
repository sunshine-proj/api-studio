import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatTab, MatTabGroup } from '@angular/material/tabs';
import { RequestSession } from '@core/services/request-session.service';
import { formatBytes } from '@core/utils/response.util';
import { KeyValueEditorComponent } from '@shared/components/key-value-editor/key-value-editor.component';
import { AuthEditorComponent } from './auth-editor.component';
import { BodyEditorComponent } from './body-editor.component';
import { RequestSaveFlow } from './request-save.service';

const STANDARD_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

@Component({
  selector: 'app-request-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButton,
    MatFormField,
    MatInput,
    MatLabel,
    MatOption,
    MatProgressBar,
    MatSelect,
    MatTab,
    MatTabGroup,
    KeyValueEditorComponent,
    AuthEditorComponent,
    BodyEditorComponent,
  ],
  host: {
    '(keydown.control.enter)': 'send()',
    '(keydown.meta.enter)': 'send()',
    '(keydown.control.s)': 'saveFromKeyboard($event)',
    '(keydown.meta.s)': 'saveFromKeyboard($event)',
  },
  templateUrl: './request-editor.component.html',
  styleUrl: './request-editor.component.scss',
})
export class RequestEditorComponent {
  protected readonly session = inject(RequestSession);
  private readonly flow = inject(RequestSaveFlow);
  protected readonly methods = STANDARD_METHODS;
  protected readonly urlPlaceholder = 'https://api.example.com/users  or  {{baseUrl}}/users';

  protected readonly draft = this.session.draft;
  protected readonly sending = computed(() => this.session.state().status === 'sending');
  protected readonly canSave = computed(() => {
    const tab = this.session.activeTab();
    return !tab.isSaved() || tab.dirty();
  });
  protected readonly enabledParams = computed(() => this.draft().params.filter((p) => p.enabled).length);
  protected readonly enabledHeaders = computed(() => this.draft().headers.filter((h) => h.enabled).length);
  protected readonly upload = computed(() => {
    const progress = this.session.uploadProgress();
    if (!progress) return null;
    if (progress.total === null || progress.total === 0) {
      return { percent: 0, label: `Uploaded ${formatBytes(progress.loaded)}` };
    }
    const percent = Math.min(100, (progress.loaded / progress.total) * 100);
    const done = progress.loaded >= progress.total;
    return {
      percent,
      label: done
        ? 'Upload complete. Waiting for the response…'
        : `Uploading ${Math.floor(percent)}% (${formatBytes(progress.loaded)} of ${formatBytes(progress.total)})`,
    };
  });

  protected send(): void {
    void this.session.send();
  }

  protected save(): void {
    void this.flow.save(this.session.activeTab());
  }

  /** Ctrl/Cmd+S saves the request instead of opening the browser's "save page" dialog. */
  protected saveFromKeyboard(event: Event): void {
    event.preventDefault();
    this.save();
  }
}
