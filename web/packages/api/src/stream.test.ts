import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SseParser, openEventStream, type StreamMessage, type StreamStatus } from './stream.ts';

function parse(chunks: string[], lastEventId = '') {
  const messages: StreamMessage[] = [];
  const retries: number[] = [];
  const parser = new SseParser(
    { onMessage: (m) => messages.push(m), onRetry: (ms) => retries.push(ms) },
    lastEventId,
  );
  for (const chunk of chunks) parser.push(chunk);
  return { messages, retries, parser };
}

describe('SseParser', () => {
  it('dispatches typed events with ids and joins multi-line data', () => {
    const { messages } = parse(['id: 7\nevent: action.decided\ndata: {"a":1,\ndata: "b":2}\n\n']);
    assert.deepEqual(messages, [{ id: '7', event: 'action.decided', data: '{"a":1,\n"b":2}' }]);
  });

  it('handles CRLF, CR and a CRLF split across chunks', () => {
    const { messages } = parse(['data: one\r', '\n\r', '\ndata: two\r\rdata: three\n', '\n']);
    assert.deepEqual(
      messages.map((m) => m.data),
      ['one', 'two', 'three'],
    );
  });

  it('reassembles a field split across chunks and strips a leading BOM', () => {
    const { messages } = parse(['﻿da', 'ta: hel', 'lo\n', '\n']);
    assert.deepEqual(messages, [{ id: '', event: 'message', data: 'hello' }]);
  });

  it('keeps the id across events, ignores comments, strips only one leading space', () => {
    const { messages, parser } = parse([': ping\n\nid: 3\ndata:  x\n\ndata: y\n\n']);
    assert.deepEqual(
      messages.map((m) => [m.id, m.data]),
      [
        ['3', ' x'],
        ['3', 'y'],
      ],
    );
    assert.equal(parser.lastEventId, '3');
  });

  it('commits an id at a boundary even when the block has no data', () => {
    const { messages, parser } = parse(['id: 9\n\n'], '2');
    assert.equal(messages.length, 0);
    assert.equal(parser.lastEventId, '9');
  });

  it('does not commit an id before its event boundary arrives', () => {
    const { parser } = parse(['id: 10\ndata: partial\n'], '9');
    assert.equal(parser.lastEventId, '9');
  });

  it('dispatches an empty data field and reports numeric retry only', () => {
    const { messages, retries } = parse(['data\n\nretry: 2500\nretry: soon\n\n']);
    assert.deepEqual(messages, [{ id: '', event: 'message', data: '' }]);
    assert.deepEqual(retries, [2500]);
  });

  it('keeps parsing after a consumer throws', () => {
    const seen: string[] = [];
    const original = console.error;
    console.error = () => {};
    try {
      const parser = new SseParser({
        onMessage: (m) => {
          seen.push(m.data);
          if (m.data === 'bad') throw new Error('consumer bug');
        },
      });
      parser.push('data: bad\n\ndata: good\n\n');
    } finally {
      console.error = original;
    }
    assert.deepEqual(seen, ['bad', 'good']);
  });
});

type Scripted =
  | { kind: 'stream'; chunks: string[]; hold?: boolean; later?: { afterMs: number; chunk: string } }
  | { kind: 'status'; status: number }
  | { kind: 'network-error' };

interface Call {
  headers: Record<string, string>;
}

function scriptedFetch(script: Scripted[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push({ headers: { ...(init.headers as Record<string, string>) } });
    const step = script.shift() ?? { kind: 'status', status: 503 };
    if (step.kind === 'network-error') throw new TypeError('fetch failed');
    if (step.kind === 'status') return new Response('nope', { status: step.status });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of step.chunks) controller.enqueue(encoder.encode(chunk));
        if (step.later) {
          const { afterMs, chunk } = step.later;
          setTimeout(() => {
            try {
              controller.enqueue(encoder.encode(chunk));
            } catch {
              // aborted meanwhile
            }
          }, afterMs);
        }
        if (!step.hold) controller.close();
        init.signal?.addEventListener('abort', () => {
          try {
            controller.error(new DOMException('aborted', 'AbortError'));
          } catch {
            // already closed
          }
        });
      },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('condition not met in time'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('openEventStream', () => {
  it('sends the bearer token, resumes with Last-Event-ID after the server closes', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { kind: 'stream', chunks: ['id: 1\ndata: a\n\n', 'id: 2\ndata: b\n\n'] },
      { kind: 'stream', chunks: ['id: 3\ndata: c\n\n'], hold: true },
    ]);
    const messages: string[] = [];
    const statuses: StreamStatus[] = [];
    const stream = openEventStream({
      url: '/api/v1/events/stream',
      fetch: fetchImpl,
      getAccessToken: async () => 'tok-1',
      onMessage: (m) => messages.push(m.data),
      onStatus: (s) => statuses.push(s),
      backoffMs: () => 0,
    });
    await until(() => messages.length === 3);
    stream.close();
    assert.deepEqual(messages, ['a', 'b', 'c']);
    assert.equal(calls[0].headers.Authorization, 'Bearer tok-1');
    assert.equal(calls[0].headers['Last-Event-ID'], undefined);
    assert.equal(calls[1].headers['Last-Event-ID'], '2');
    assert.equal(stream.lastEventId, '3');
    assert.deepEqual(statuses, ['connecting', 'live', 'reconnecting', 'live']);
  });

  it('reports offline after maxAttempts consecutive failures and stops', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { kind: 'status', status: 502 },
      { kind: 'network-error' },
      { kind: 'status', status: 200 },
    ]);
    const statuses: StreamStatus[] = [];
    openEventStream({
      url: '/s',
      fetch: fetchImpl,
      onMessage: () => {},
      onStatus: (s) => statuses.push(s),
      maxAttempts: 3,
      backoffMs: () => 0,
    });
    await until(() => statuses.at(-1) === 'offline');
    await sleep(30);
    assert.equal(calls.length, 3);
    assert.deepEqual(statuses, ['connecting', 'reconnecting', 'offline']);
  });

  it('goes offline at once on 403', async () => {
    const { fetchImpl, calls } = scriptedFetch([{ kind: 'status', status: 403 }]);
    const statuses: StreamStatus[] = [];
    openEventStream({
      url: '/s',
      fetch: fetchImpl,
      onMessage: () => {},
      onStatus: (s) => statuses.push(s),
      backoffMs: () => 0,
    });
    await until(() => statuses.at(-1) === 'offline');
    await sleep(30);
    assert.equal(calls.length, 1);
  });

  it('reports stale on silence, then drops and resumes from Last-Event-ID', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { kind: 'stream', chunks: ['id: 5\ndata: x\n\n'], hold: true },
      { kind: 'stream', chunks: [], hold: true },
    ]);
    const statuses: StreamStatus[] = [];
    const stream = openEventStream({
      url: '/s',
      fetch: fetchImpl,
      onMessage: () => {},
      onStatus: (s) => statuses.push(s),
      staleAfterMs: 20,
      dropAfterMs: 60,
      backoffMs: () => 0,
    });
    await until(() => calls.length === 2);
    stream.close();
    assert.equal(calls[1].headers['Last-Event-ID'], '5');
    assert.deepEqual(statuses.slice(0, 4), ['connecting', 'live', 'stale', 'reconnecting']);
  });

  it('returns from stale to live when bytes arrive again', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { kind: 'stream', chunks: [], hold: true, later: { afterMs: 50, chunk: ': ping\n\n' } },
    ]);
    const statuses: StreamStatus[] = [];
    const stream = openEventStream({
      url: '/s',
      fetch: fetchImpl,
      onMessage: () => {},
      onStatus: (s) => statuses.push(s),
      staleAfterMs: 20,
      dropAfterMs: 500,
      backoffMs: () => 0,
    });
    await until(() => statuses.length === 4);
    stream.close();
    assert.deepEqual(statuses, ['connecting', 'live', 'stale', 'live']);
    assert.equal(calls.length, 1);
  });

  it('retry() replaces the live attempt without a second parallel connection', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { kind: 'stream', chunks: [], hold: true },
      { kind: 'stream', chunks: [], hold: true },
      { kind: 'stream', chunks: [], hold: true },
    ]);
    const stream = openEventStream({
      url: '/s',
      fetch: fetchImpl,
      onMessage: () => {},
      backoffMs: () => 0,
    });
    await until(() => calls.length === 1);
    await sleep(10);
    stream.retry();
    await sleep(50);
    stream.close();
    assert.equal(calls.length, 2);
  });

  it('ignores a replaced attempt whose fetch settles late (p-247)', async () => {
    const encoder = new TextEncoder();
    const sse = (text: string) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(encoder.encode(text));
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    let releaseFirst: (r: Response) => void = () => {};
    let calls = 0;
    // The first fetch ignores its abort signal and settles late, as a fetch wrapper can.
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) return new Promise<Response>((resolve) => (releaseFirst = resolve));
      return sse('id: 2\ndata: second\n\n');
    }) as unknown as typeof fetch;
    const received: string[] = [];
    const statuses: StreamStatus[] = [];
    const stream = openEventStream({
      url: '/s',
      fetch: fetchImpl,
      onMessage: (m) => received.push(m.id),
      onStatus: (s) => statuses.push(s),
      backoffMs: () => 0,
    });
    await until(() => calls === 1);
    stream.retry();
    await until(() => received.length === 1);
    releaseFirst(sse('id: 99\ndata: stale\n\n'));
    await sleep(30);
    stream.close();
    assert.deepEqual(received, ['2']);
    assert.equal(stream.lastEventId, '2');
  });

  it('close() stops reconnecting', async () => {
    const { fetchImpl, calls } = scriptedFetch([{ kind: 'stream', chunks: ['data: a\n\n'] }]);
    const stream = openEventStream({
      url: '/s',
      fetch: fetchImpl,
      onMessage: () => stream.close(),
      backoffMs: () => 0,
    });
    await sleep(50);
    assert.equal(calls.length, 1);
  });
});
