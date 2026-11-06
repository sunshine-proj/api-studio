import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatCheckbox } from '@angular/material/checkbox';
import { RequestScripts } from '@core/models';
import { RequestSession } from '@core/services/request-session.service';
import { CodeEditorComponent } from '@shared/components/code-editor/code-editor.component';

const EMPTY: RequestScripts = { enabled: true, preRequest: '', test: '' };

/** Pre-request and test scripts. They run in an isolated sandbox with no network or page access. */
@Component({
  selector: 'app-scripts-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CodeEditorComponent, MatCheckbox],
  template: `
    <div class="head">
      <mat-checkbox [checked]="scripts().enabled" (change)="update({ enabled: $event.checked })">Run these scripts when sending</mat-checkbox>
      <p class="note">
        Scripts run in an isolated sandbox: no network, no access to this page or your stored data, and a
        5 second limit. They can read and change the request, read the response, and set variables. Imported scripts are
        always switched off until you enable them here.
      </p>
    </div>

    <div class="pane">
      <span class="label">Pre-request script</span>
      <div class="editor">
        <app-code-editor label="Pre-request script" language="javascript" [value]="scripts().preRequest" (valueChange)="update({ preRequest: $event })" />
      </div>
    </div>
    <div class="pane">
      <span class="label">Test script (runs after the response)</span>
      <div class="editor">
        <app-code-editor label="Test script" language="javascript" [value]="scripts().test" (valueChange)="update({ test: $event })" />
      </div>
    </div>

    <details class="reference">
      <summary>Script API</summary>
      <pre>
request.method, request.url, request.headers {{ '{' }}name: value{{ '}' }}, request.body   (change these in a pre-request script)
response.status, response.statusText, response.headers, response.body, response.time, response.json()   (test script)
env.get(name), env.set(name, value), env.has(name), env.all()
test(name, () =&gt; assert.equal(response.status, 200))
assert(condition, message)
console.log(...)   (shown under the response's Tests tab)</pre>
    </details>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .head,
    .reference {
      padding: 4px 12px;
    }
    .note {
      margin: 0 0 4px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .pane {
      display: flex;
      flex: 1 1 0;
      flex-direction: column;
      min-height: 120px;
    }
    .label {
      margin: 4px 12px 2px;
      font: var(--mat-sys-label-medium);
    }
    .editor {
      flex: 1 1 0;
      min-height: 80px;
      margin: 0 12px 8px;
      border: 1px solid var(--mat-sys-outline-variant);
    }
    pre {
      margin: 4px 0;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
    }
  `,
})
export class ScriptsEditorComponent {
  private readonly session = inject(RequestSession);
  protected readonly scripts = computed(() => this.session.draft().scripts ?? EMPTY);

  protected update(changes: Partial<RequestScripts>): void {
    this.session.setScripts({ ...this.scripts(), ...changes });
  }
}
