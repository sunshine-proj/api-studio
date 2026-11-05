import { isUploadBody, toBodyInit } from './body-builder.util';

describe('toBodyInit', () => {
  it('returns nothing, text and blobs unchanged', () => {
    const blob = new Blob(['x']);
    expect(toBodyInit({ type: 'none' })).toBeUndefined();
    expect(toBodyInit({ type: 'text', content: 'hi' })).toBe('hi');
    expect(toBodyInit({ type: 'binary', blob })).toBe(blob);
  });

  it('builds native FormData keeping order, repeated names and file names', () => {
    const a = new Blob(['A'], { type: 'text/plain' });
    const b = new Blob(['B']);
    const form = toBodyInit({
      type: 'multipart',
      fields: [
        { kind: 'text', name: 'tag', value: '1' },
        { kind: 'file', name: 'f', blob: a, filename: 'a.txt' },
        { kind: 'text', name: 'tag', value: '2' },
        { kind: 'file', name: 'f', blob: b, filename: 'b.bin' },
      ],
    }) as FormData;

    expect(form).toBeInstanceOf(FormData);
    const entries = [...form.entries()];
    expect(entries.map(([name]) => name)).toEqual(['tag', 'f', 'tag', 'f']);
    expect(form.getAll('tag')).toEqual(['1', '2']);
    expect((entries[1][1] as File).name).toBe('a.txt');
    expect((entries[3][1] as File).name).toBe('b.bin');
  });

  it('flags only file bodies as uploads', () => {
    expect(isUploadBody({ type: 'multipart', fields: [] })).toBe(true);
    expect(isUploadBody({ type: 'binary', blob: new Blob() })).toBe(true);
    expect(isUploadBody({ type: 'text', content: '' })).toBe(false);
  });
});
