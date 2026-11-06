import { SseEvent, SseParser } from './sse-parser.util';

function parse(...chunks: string[]): { events: SseEvent[]; parser: SseParser } {
  const events: SseEvent[] = [];
  const parser = new SseParser((e) => events.push(e));
  for (const chunk of chunks) parser.push(chunk);
  return { events, parser };
}

describe('SseParser', () => {
  it('parses a simple event', () => {
    expect(parse('data: hello\n\n').events).toEqual([{ event: 'message', data: 'hello', id: null, retry: null }]);
  });

  it('joins multi-line data with newlines and reads event, id and retry', () => {
    const { events } = parse('event: update\nid: 7\nretry: 3000\ndata: one\ndata: two\n\n');
    expect(events).toEqual([{ event: 'update', data: 'one\ntwo', id: '7', retry: 3000 }]);
  });

  it('removes only one leading space from a value', () => {
    expect(parse('data:  two spaces\n\n').events[0].data).toBe(' two spaces');
    expect(parse('data:none\n\n').events[0].data).toBe('none');
    expect(parse('data\n\n').events[0].data).toBe('');
  });

  it('accepts LF, CRLF and CR line endings', () => {
    expect(parse('data: a\r\n\r\ndata: b\r\rdata: c\n\n').events.map((e) => e.data)).toEqual(['a', 'b', 'c']);
  });

  it('copes with chunks that split a line, a field or a CRLF pair anywhere', () => {
    const wire = 'event: x\r\ndata: split\r\n\r\ndata: next\n\n';
    for (let cut = 1; cut < wire.length; cut++) {
      const { events } = parse(wire.slice(0, cut), wire.slice(cut));
      expect(events.map((e) => [e.event, e.data])).toEqual([['x', 'split'], ['message', 'next']]);
    }
    // One character at a time.
    expect(parse(...wire.split('')).events).toHaveLength(2);
  });

  it('does not emit an event that was never completed by a blank line', () => {
    expect(parse('data: partial\n').events).toEqual([]);
    expect(parse('data: partial').events).toEqual([]);
  });

  it('ignores comments, unknown fields and events without data', () => {
    expect(parse(': keep-alive\n\nevent: only-a-name\n\nfoo: bar\ndata: real\n\n').events.map((e) => e.data)).toEqual(['real']);
  });

  it('keeps the last event id across events, and resets the event type', () => {
    const { events, parser } = parse('id: 1\ndata: a\n\nevent: b\ndata: b\n\ndata: c\n\n');
    expect(events.map((e) => [e.event, e.id])).toEqual([['message', '1'], ['b', '1'], ['message', '1']]);
    expect(parser.lastEventId).toBe('1');
  });

  it('ignores an id containing NUL and a non-numeric retry', () => {
    const { events } = parse('id: a\0b\nretry: soon\ndata: x\n\n');
    expect(events[0]).toMatchObject({ id: null, retry: null });
  });

  it('strips a leading byte order mark', () => {
    expect(parse('﻿data: x\n\n').events[0].data).toBe('x');
  });

  it('handles a large number of events', () => {
    const wire = Array.from({ length: 5000 }, (_, i) => `data: ${i}\n\n`).join('');
    expect(parse(wire).events).toHaveLength(5000);
  });
});
