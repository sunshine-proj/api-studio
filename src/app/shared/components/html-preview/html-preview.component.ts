import { ChangeDetectionStrategy, Component, ElementRef, effect, input, viewChild } from '@angular/core';

/**
 * Blocks everything the previewed page could load: scripts, remote images,
 * fonts, frames and requests. Inline styles and data: images still work.
 * This is a second layer; the iframe sandbox below is the primary one.
 */
const PREVIEW_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`;

/**
 * Shows untrusted HTML (a response body) in an iframe with an empty `sandbox`
 * attribute: no scripts, no same-origin access, no forms, no popups, no
 * navigation of the application. Never add `allow-scripts` or
 * `allow-same-origin` here (see AGENTS.md section 9).
 */
@Component({
  selector: 'app-html-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<iframe #frame sandbox="" referrerpolicy="no-referrer" [attr.title]="label()"></iframe>`,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    iframe {
      width: 100%;
      height: 100%;
      min-height: 160px;
      border: 0;
      background: #fff;
    }
  `,
})
export class HtmlPreviewComponent {
  readonly html = input.required<string>();
  readonly label = input('HTML preview');
  private readonly frame = viewChild.required<ElementRef<HTMLIFrameElement>>('frame');

  constructor() {
    effect(() => {
      // Assigned as a property rather than bound in the template, so Angular's sanitizer does not rewrite it.
      this.frame().nativeElement.srcdoc = PREVIEW_CSP + this.html();
    });
  }
}
