import { ImportNotes, MAX_LIST_ITEMS, isRecord, readBoolean, readList, readNumber, readOneOf, readRecords, readString } from './reading.util';

describe('reading helpers', () => {
  it('return the fallback for values of the wrong type', () => {
    expect(readString(5, 'x')).toBe('x');
    expect(readString('a')).toBe('a');
    expect(readBoolean('true', false)).toBe(false);
    expect(readNumber('7', 3)).toBe(3);
    expect(readNumber(NaN, 3)).toBe(3);
    expect(readNumber(Infinity, 3)).toBe(3);
    expect(readOneOf('GET', ['a', 'b'] as const, 'a')).toBe('a');
  });

  it('clamp numbers', () => {
    expect(readNumber(-5, 0, 0, 10)).toBe(0);
    expect(readNumber(50, 0, 0, 10)).toBe(10);
  });

  it('treat arrays as non-records and cap list length', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord({})).toBe(true);
    expect(readList('nope')).toEqual([]);
    expect(readList(new Array(MAX_LIST_ITEMS + 10).fill(1))).toHaveLength(MAX_LIST_ITEMS);
    expect(readRecords([1, {}, [], null, { a: 1 }])).toEqual([{}, { a: 1 }]);
  });
});

describe('ImportNotes', () => {
  it('drops duplicates and summarizes overflow', () => {
    const notes = new ImportNotes();
    notes.add('same');
    notes.add('same');
    for (let i = 0; i < 60; i++) notes.add(`note ${i}`);
    const all = notes.toArray();
    expect(all.filter((m) => m === 'same')).toHaveLength(1);
    expect(all.at(-1)).toMatch(/^…and \d+ more\.$/);
    expect(all.length).toBe(51);
  });
});
