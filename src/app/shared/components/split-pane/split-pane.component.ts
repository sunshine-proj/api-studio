import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal } from '@angular/core';

/**
 * Two resizable panes. Project content with the `first` and `second`
 * attributes. The divider can be dragged or moved with the arrow keys.
 */
@Component({
  selector: 'app-split-pane',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.vertical]': 'direction() === "vertical"' },
  template: `
    <div class="pane" [style.flex-basis.%]="size()"><ng-content select="[first]" /></div>
    <div
      class="divider"
      role="separator"
      tabindex="0"
      [attr.aria-orientation]="direction() === 'vertical' ? 'horizontal' : 'vertical'"
      [attr.aria-label]="label()"
      [attr.aria-valuenow]="rounded()"
      aria-valuemin="0"
      aria-valuemax="100"
      (pointerdown)="startDrag($event)"
      (pointermove)="drag($event)"
      (pointerup)="endDrag($event)"
      (pointercancel)="endDrag($event)"
      (keydown)="onKey($event)"
    ></div>
    <div class="pane rest"><ng-content select="[second]" /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: row;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
    }
    :host(.vertical) {
      flex-direction: column;
    }
    .pane {
      flex: 0 0 auto;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    .rest {
      flex: 1 1 0;
    }
    .divider {
      flex: 0 0 5px;
      background: var(--mat-sys-outline-variant);
      cursor: col-resize;
      touch-action: none;
    }
    :host(.vertical) > .divider {
      cursor: row-resize;
    }
    .divider:hover,
    .divider:focus-visible,
    .divider.dragging {
      background: var(--mat-sys-primary);
      outline: none;
    }
  `,
})
export class SplitPaneComponent {
  readonly direction = input<'horizontal' | 'vertical'>('horizontal');
  /** Initial size of the first pane, as a percentage. */
  readonly initialPercent = input(50);
  /** Minimum pixel size of either pane. */
  readonly minPx = input(120);
  readonly label = input('Resize panels');

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly override = signal<number | null>(null);
  protected readonly size = computed(() => this.override() ?? this.initialPercent());
  protected readonly rounded = computed(() => Math.round(this.size()));
  private dragging = false;

  protected startDrag(event: PointerEvent): void {
    this.dragging = true;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    (event.target as HTMLElement).classList.add('dragging');
  }

  protected drag(event: PointerEvent): void {
    if (!this.dragging) return;
    const rect = this.element.nativeElement.getBoundingClientRect();
    const vertical = this.direction() === 'vertical';
    const total = vertical ? rect.height : rect.width;
    const position = vertical ? event.clientY - rect.top : event.clientX - rect.left;
    this.setPercent((position / total) * 100, total);
  }

  protected endDrag(event: PointerEvent): void {
    this.dragging = false;
    (event.target as HTMLElement).classList.remove('dragging');
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  protected onKey(event: KeyboardEvent): void {
    const vertical = this.direction() === 'vertical';
    const decrease = vertical ? 'ArrowUp' : 'ArrowLeft';
    const increase = vertical ? 'ArrowDown' : 'ArrowRight';
    if (event.key !== decrease && event.key !== increase) return;
    event.preventDefault();
    const rect = this.element.nativeElement.getBoundingClientRect();
    this.setPercent(this.size() + (event.key === increase ? 2 : -2), vertical ? rect.height : rect.width);
  }

  private setPercent(percent: number, totalPx: number): void {
    const minPercent = totalPx > 0 ? Math.min((this.minPx() / totalPx) * 100, 45) : 10;
    this.override.set(Math.min(100 - minPercent, Math.max(minPercent, percent)));
  }
}
