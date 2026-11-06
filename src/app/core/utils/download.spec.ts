import { filenameFromDisposition, sanitizeFilename, suggestFilename } from './download';

describe('download helpers', () => {
  it('reads plain and encoded names from Content-Disposition', () => {
    expect(filenameFromDisposition('attachment; filename="report.pdf"')).toBe('report.pdf');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''na%C3%AFve.txt")).toBe('naïve.txt');
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition('inline')).toBeNull();
  });

  it('removes path separators so a server cannot pick a directory', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitizeFilename('  ')).toBe('response');
  });

  it('prefers the header, then the URL, then a generic name', () => {
    expect(suggestFilename('attachment; filename="a.csv"', 'https://x.test/b.json', 'text/csv')).toBe('a.csv');
    expect(suggestFilename(null, 'https://x.test/files/photo.png?v=2', 'image/png')).toBe('photo.png');
    expect(suggestFilename(null, 'https://x.test/', 'application/pdf')).toBe('response.pdf');
  });

  it('adds an extension from the content type when the name has none', () => {
    expect(suggestFilename(null, 'https://x.test/users', 'application/json; charset=utf-8')).toBe('users.json');
    expect(suggestFilename(null, 'https://x.test/data', 'application/vnd.api+json')).toBe('data.json');
    expect(suggestFilename(null, 'https://x.test/blob', 'application/octet-stream')).toBe('blob.bin');
    expect(suggestFilename(null, 'https://x.test/blob', null)).toBe('blob');
  });

  it('copes with an unparsable URL', () => {
    expect(suggestFilename(null, 'not a url', 'text/plain')).toBe('response.txt');
  });
});
