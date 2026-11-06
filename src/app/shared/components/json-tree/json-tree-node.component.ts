import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, signal } from '@angular/core';
import { isJsonContainer, jsonChildren, jsonKind, jsonScalarText, jsonSummary } from '@core/utils/json-tree.util';

/** How many children of a large object or array are rendered at once. */
const PAGE_SIZE = 100;

/** One node of the JSON tree. Children are only rendered while the node is open, so large documents stay fast. */
@Component({
  selector: 'app-json-tree-node',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (container()) {
      <div class="line">
        <button
          type="button"
          class="toggle"
          [attr.aria-expanded]="open()"
          [attr.aria-label]="(open() ? 'Collapse ' : 'Expand ') + (label() ?? 'root')"
          (click)="open.set(!open())"
        >
          {{ open() ? '▾' : '▸' }}
        </button>
        @if (label() !== null) {
          <span class="key">{{ label() }}</span><span class="punct">:</span>
        }
        <span class="summary">{{ summary() }}</span>
      </div>
      @if (open()) {
        <ul>
          @for (child of visible(); track child[0]) {
            <li><app-json-tree-node [label]="child[0]" [value]="child[1]" [depth]="depth() + 1" /></li>
          }
          @if (hidden() > 0) {
            <li class="line">
              <button type="button" class="more" (click)="shown.set(shown() + pageSize)">
                Show {{ hidden() > pageSize ? pageSize : hidden() }} more ({{ hidden() }} not shown)
              </button>
            </li>
          }
        </ul>
      }
    } @else {
      <div class="line leaf">
        @if (label() !== null) {
          <span class="key">{{ label() }}</span><span class="punct">:</span>
        }
        <span [class]="'value ' + kind()">{{ text() }}</span>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    ul {
      margin: 0;
      padding: 0 0 0 18px;
      list-style: none;
      border-left: 1px solid var(--mat-sys-outline-variant);
      margin-left: 6px;
    }
    .line {
      display: flex;
      align-items: baseline;
      gap: 4px;
      min-height: 20px;
    }
    .leaf {
      padding-left: 22px;
    }
    .toggle,
    .more {
      color: inherit;
      font: inherit;
      background: transparent;
      border: 0;
      cursor: pointer;
    }
    .toggle {
      width: 18px;
      padding: 0;
    }
    .more {
      color: var(--mat-sys-primary);
      text-decoration: underline;
    }
    .toggle:focus-visible,
    .more:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
    }
    .key {
      color: var(--mat-sys-primary);
    }
    .summary,
    .punct,
    .null {
      color: var(--mat-sys-on-surface-variant);
    }
    .value {
      overflow-wrap: anywhere;
    }
    .string {
      color: var(--mat-sys-tertiary);
    }
    .number,
    .boolean {
      color: var(--mat-sys-secondary);
    }
  `,
})
export class JsonTreeNodeComponent {
  readonly label = input<string | null>(null);
  readonly value = input<unknown>(null);
  readonly depth = input(0);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly shown = signal(PAGE_SIZE);
  /** The top two levels start open; deeper ones are opened by the user. */
  protected readonly open = linkedSignal(() => this.depth() < 2);

  protected readonly container = computed(() => isJsonContainer(this.value()));
  protected readonly kind = computed(() => jsonKind(this.value()));
  protected readonly summary = computed(() => jsonSummary(this.value()));
  protected readonly text = computed(() => jsonScalarText(this.value()));
  private readonly children = computed(() => jsonChildren(this.value()));
  protected readonly visible = computed(() => this.children().slice(0, this.shown()));
  protected readonly hidden = computed(() => Math.max(0, this.children().length - this.shown()));
}
