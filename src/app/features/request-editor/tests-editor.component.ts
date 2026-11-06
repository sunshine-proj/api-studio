import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatCheckbox } from '@angular/material/checkbox';
import { Assertion, AssertionOperator, AssertionTarget, Extraction, ExtractionSource } from '@core/models';
import { RequestSession } from '@core/services/request-session.service';
import { OPERATOR_LABELS, TARGET_LABELS, operatorTakesValue, targetTakesProperty } from '@core/testing/assertions.util';
import { newId } from '@core/utils/id';

const SOURCE_LABELS: Readonly<Record<ExtractionSource, string>> = {
  json: 'JSON path',
  header: 'Header',
  status: 'Status code',
  regex: 'Body regex',
};

const SOURCE_PLACEHOLDERS: Readonly<Record<ExtractionSource, string>> = {
  json: '$.data.id',
  header: 'Location',
  status: '',
  regex: 'token=(\\w+)',
};

/** Assertions on the response, and values copied out of it into variables for the next request (chaining). */
@Component({
  selector: 'app-tests-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCheckbox],
  template: `
    <section aria-labelledby="assertions-title">
      <h3 id="assertions-title">Assertions</h3>
      <p class="note">Checked after each send. Results appear in the response's Tests tab and when running a collection.</p>
      @for (row of assertions(); track row.id) {
        <div class="row">
          <mat-checkbox [checked]="row.enabled" (change)="updateAssertion(row.id, { enabled: $event.checked })" aria-label="Enable assertion" />
          <select aria-label="Check" [value]="row.target" (change)="updateAssertion(row.id, { target: $any($event.target).value })">
            @for (target of targets; track target) {
              <option [value]="target" [selected]="target === row.target">{{ targetLabels[target] }}</option>
            }
          </select>
          @if (takesProperty(row.target)) {
            <input
              [attr.aria-label]="row.target === 'header' ? 'Header name' : 'JSON path'"
              [placeholder]="row.target === 'header' ? 'Content-Type' : '$.data.id'"
              autocomplete="off"
              [value]="row.property"
              (input)="updateAssertion(row.id, { property: $any($event.target).value })"
            />
          }
          <select aria-label="Operator" [value]="row.operator" (change)="updateAssertion(row.id, { operator: $any($event.target).value })">
            @for (operator of operators; track operator) {
              <option [value]="operator" [selected]="operator === row.operator">{{ operatorLabels[operator] }}</option>
            }
          </select>
          @if (takesValue(row.operator)) {
            <input
              aria-label="Expected value"
              placeholder="Expected"
              autocomplete="off"
              [value]="row.expected"
              (input)="updateAssertion(row.id, { expected: $any($event.target).value })"
            />
          }
          <button type="button" class="remove" aria-label="Remove assertion" (click)="removeAssertion(row.id)">×</button>
        </div>
      }
      <button type="button" class="add" (click)="addAssertion()">Add assertion</button>
    </section>

    <section aria-labelledby="extractions-title">
      <h3 id="extractions-title">Extract to variables</h3>
      <p class="note">
        Copies a value from the response into a variable of the selected environment, so later requests can use it as
        <code ngNonBindable>{{name}}</code>. Without a selected environment the values cannot be kept.
      </p>
      @for (row of extractions(); track row.id) {
        <div class="row">
          <mat-checkbox [checked]="row.enabled" (change)="updateExtraction(row.id, { enabled: $event.checked })" aria-label="Enable extraction" />
          <input
            aria-label="Variable name"
            placeholder="variable"
            autocomplete="off"
            [value]="row.variable"
            (input)="updateExtraction(row.id, { variable: $any($event.target).value })"
          />
          <select aria-label="Take from" [value]="row.source" (change)="updateExtraction(row.id, { source: $any($event.target).value })">
            @for (source of sources; track source) {
              <option [value]="source" [selected]="source === row.source">{{ sourceLabels[source] }}</option>
            }
          </select>
          @if (row.source !== 'status') {
            <input
              aria-label="Expression"
              [placeholder]="placeholders[row.source]"
              autocomplete="off"
              [value]="row.expression"
              (input)="updateExtraction(row.id, { expression: $any($event.target).value })"
            />
          }
          <mat-checkbox [checked]="row.secret" (change)="updateExtraction(row.id, { secret: $event.checked })">Secret</mat-checkbox>
          <button type="button" class="remove" aria-label="Remove extraction" (click)="removeExtraction(row.id)">×</button>
        </div>
      }
      <button type="button" class="add" (click)="addExtraction()">Add extraction</button>
    </section>
  `,
  styles: `
    :host {
      display: block;
      padding: 8px 12px 16px;
    }
    h3 {
      margin: 12px 0 2px;
      font: var(--mat-sys-title-small);
    }
    .note {
      margin: 0 0 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    input,
    select {
      height: 30px;
      padding: 0 8px;
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
    }
    input {
      flex: 1 1 0;
      min-width: 0;
    }
    option {
      color: initial;
    }
    .add {
      height: 28px;
      padding: 0 12px;
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
      cursor: pointer;
    }
    .remove {
      width: 28px;
      height: 28px;
      font-size: 18px;
      color: var(--mat-sys-on-surface-variant);
      background: transparent;
      border: 0;
      cursor: pointer;
    }
  `,
})
export class TestsEditorComponent {
  private readonly session = inject(RequestSession);

  protected readonly targets = Object.keys(TARGET_LABELS) as AssertionTarget[];
  protected readonly operators = Object.keys(OPERATOR_LABELS) as AssertionOperator[];
  protected readonly sources = Object.keys(SOURCE_LABELS) as ExtractionSource[];
  protected readonly targetLabels = TARGET_LABELS;
  protected readonly operatorLabels = OPERATOR_LABELS;
  protected readonly sourceLabels = SOURCE_LABELS;
  protected readonly placeholders = SOURCE_PLACEHOLDERS;
  protected readonly takesProperty = targetTakesProperty;
  protected readonly takesValue = operatorTakesValue;

  protected readonly assertions = computed(() => this.session.draft().assertions ?? []);
  protected readonly extractions = computed(() => this.session.draft().extractions ?? []);

  protected addAssertion(): void {
    const row: Assertion = { id: newId(), enabled: true, target: 'status', property: '', operator: 'equals', expected: '200' };
    this.session.setAssertions([...this.assertions(), row]);
  }

  protected updateAssertion(id: string, changes: Partial<Assertion>): void {
    this.session.setAssertions(this.assertions().map((row) => (row.id === id ? { ...row, ...changes } : row)));
  }

  protected removeAssertion(id: string): void {
    this.session.setAssertions(this.assertions().filter((row) => row.id !== id));
  }

  protected addExtraction(): void {
    const row: Extraction = { id: newId(), enabled: true, variable: '', source: 'json', expression: '', secret: false };
    this.session.setExtractions([...this.extractions(), row]);
  }

  protected updateExtraction(id: string, changes: Partial<Extraction>): void {
    this.session.setExtractions(this.extractions().map((row) => (row.id === id ? { ...row, ...changes } : row)));
  }

  protected removeExtraction(id: string): void {
    this.session.setExtractions(this.extractions().filter((row) => row.id !== id));
  }
}
