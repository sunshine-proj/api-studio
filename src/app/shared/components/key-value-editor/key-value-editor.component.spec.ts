import { TestBed } from '@angular/core/testing';
import { KeyValue } from '@core/models';
import { KeyValueEditorComponent } from './key-value-editor.component';

describe('KeyValueEditorComponent', () => {
  function setup(initial: readonly KeyValue[] = []) {
    const fixture = TestBed.createComponent(KeyValueEditorComponent);
    fixture.componentRef.setInput('items', initial);
    const emitted: (readonly KeyValue[])[] = [];
    fixture.componentInstance.items.subscribe((items) => emitted.push(items));
    fixture.detectChanges();
    const inputs = (): HTMLInputElement[] => Array.from(fixture.nativeElement.querySelectorAll('input:not([type=checkbox])'));
    const type = (el: HTMLInputElement, value: string): void => {
      el.value = value;
      el.dispatchEvent(new Event('input'));
    };
    return { fixture, emitted, inputs, type };
  }

  it('always renders one empty row to type into', () => {
    const { inputs } = setup();
    expect(inputs()).toHaveLength(2);
    expect(inputs()[0].getAttribute('aria-label')).toBe('New Key');
  });

  it('turns the empty row into a real row without losing fast keystrokes', () => {
    const { fixture, emitted, inputs, type } = setup();
    const keyInput = inputs()[0];

    // Two keystrokes arrive before Angular re-renders.
    type(keyInput, 'X');
    type(keyInput, 'X-');
    expect(fixture.componentInstance.items().map((i) => i.key)).toEqual(['X-']);
    expect(emitted.at(-1)?.[0].key).toBe('X-');

    fixture.detectChanges();
    expect(inputs()).toHaveLength(4);
    expect(inputs()[0]).toBe(keyInput);
    expect(inputs()[0].getAttribute('aria-label')).toBe('Key');
  });

  it('edits, toggles and removes existing rows', () => {
    const { fixture, inputs, type } = setup([{ id: 'a', key: 'k', value: 'v', enabled: true }]);
    type(inputs()[1], 'new');
    expect(fixture.componentInstance.items()[0].value).toBe('new');

    fixture.nativeElement.querySelector('button.remove').click();
    expect(fixture.componentInstance.items()).toEqual([]);
  });
});
