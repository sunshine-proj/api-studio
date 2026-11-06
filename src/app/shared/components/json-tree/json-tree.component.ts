import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { JsonTreeNodeComponent } from './json-tree-node.component';

/** Collapsible view of parsed JSON. */
@Component({
  selector: 'app-json-tree',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JsonTreeNodeComponent],
  template: `<div class="tree" role="region" [attr.aria-label]="label()"><app-json-tree-node [value]="value()" /></div>`,
  styles: `
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    .tree {
      padding: 8px 12px;
      font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
  `,
})
export class JsonTreeComponent {
  readonly value = input<unknown>(null);
  readonly label = input('JSON tree');
}
