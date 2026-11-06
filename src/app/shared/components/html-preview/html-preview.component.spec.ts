import { TestBed } from '@angular/core/testing';
import { HtmlPreviewComponent } from './html-preview.component';

describe('HtmlPreviewComponent', () => {
  function render(html: string): HTMLIFrameElement {
    const fixture = TestBed.createComponent(HtmlPreviewComponent);
    fixture.componentRef.setInput('html', html);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
  }

  it('renders untrusted HTML in a fully sandboxed iframe', () => {
    const frame = render('<script>alert(1)</script><p>hi</p>');
    // An empty sandbox attribute applies every restriction. Adding allow-scripts or
    // allow-same-origin here would let a response run code with access to the app.
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('passes the body through unchanged, behind a restrictive content security policy', () => {
    const body = '<h1>Title</h1><img src="https://tracker.example/p.png">';
    const frame = render(body);
    expect(frame.srcdoc.endsWith(body)).toBe(true);
    expect(frame.srcdoc).toContain("default-src 'none'");
    expect(frame.srcdoc).toContain('img-src data:');
  });

  it('updates the frame when the response changes', () => {
    const fixture = TestBed.createComponent(HtmlPreviewComponent);
    fixture.componentRef.setInput('html', '<p>one</p>');
    fixture.detectChanges();
    fixture.componentRef.setInput('html', '<p>two</p>');
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement).srcdoc).toContain('<p>two</p>');
  });
});
