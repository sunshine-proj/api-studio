import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';

/**
 * Shows an image response. The bytes are given the response's image type so
 * SVG renders; inside an `<img>` an SVG cannot run scripts.
 */
@Component({
  selector: 'app-image-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (failed()) {
      <p class="note" role="alert">The response could not be displayed as an image. It may be corrupted or in a format this browser does not support. Download it instead.</p>
    } @else if (url(); as src) {
      <img [src]="src" alt="Response image" (load)="loaded($event)" (error)="failed.set(true)" />
      @if (dimensions(); as size) {
        <p class="note">{{ size }}</p>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      padding: 12px;
      overflow: auto;
    }
    img {
      max-width: 100%;
      background: repeating-conic-gradient(#8884 0% 25%, transparent 0% 50%) 50% / 16px 16px;
    }
    .note {
      margin: 8px 0 0;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class ImagePreviewComponent {
  readonly blob = input.required<Blob>();
  readonly contentType = input<string | null>(null);

  protected readonly url = signal<string | null>(null);
  protected readonly failed = signal(false);
  protected readonly dimensions = signal<string | null>(null);

  constructor() {
    effect((onCleanup) => {
      const type = (this.contentType() ?? '').split(';')[0].trim();
      const objectUrl = URL.createObjectURL(new Blob([this.blob()], { type }));
      this.url.set(objectUrl);
      this.failed.set(false);
      this.dimensions.set(null);
      onCleanup(() => URL.revokeObjectURL(objectUrl));
    });
  }

  protected loaded(event: Event): void {
    const image = event.target as HTMLImageElement;
    this.dimensions.set(`${image.naturalWidth} × ${image.naturalHeight} px`);
  }
}
