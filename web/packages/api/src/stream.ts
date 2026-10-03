// Server-sent events over fetch(). EventSource cannot send an Authorization header, so the
// Gateway stream is read here with a bearer token and the Last-Event-ID resume header.
// Parsing follows the WHATWG event-stream rules.

export type StreamStatus = 'connecting' | 'live' | 'stale' | 'reconnecting' | 'offline';

export interface StreamMessage {
  id: string;
  event: string;
  data: string;
}

interface ParserHandlers {
  onMessage: (message: StreamMessage) => void;
  onRetry?: (ms: number) => void;
}

export class SseParser {
  private readonly handlers: ParserHandlers;
  private partial = '';
  private started = false;
  private skipLeadingLf = false;
  private dataLines: string[] = [];
  private eventType = '';
  private idBuffer: string;
  /** The id in force at the last event boundary: what a reconnect sends as Last-Event-ID. */
  lastEventId: string;

  constructor(handlers: ParserHandlers, lastEventId = '') {
    this.handlers = handlers;
    this.idBuffer = lastEventId;
    this.lastEventId = lastEventId;
  }

  push(chunk: string): void {
    let text = chunk;
    if (!this.started && text.length > 0) {
      this.started = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    // A CR that ended the previous chunk may be the first half of a CRLF.
    if (this.skipLeadingLf && text.length > 0) {
      this.skipLeadingLf = false;
      if (text.charCodeAt(0) === 10) text = text.slice(1);
    }
    const buffer = this.partial + text;
    let lineStart = 0;
    for (let i = 0; i < buffer.length; i++) {
      const ch = buffer.charCodeAt(i);
      if (ch !== 10 && ch !== 13) continue;
      this.processLine(buffer.slice(lineStart, i));
      if (ch === 13) {
        if (i + 1 === buffer.length) this.skipLeadingLf = true;
        else if (buffer.charCodeAt(i + 1) === 10) i++;
      }
      lineStart = i + 1;
    }
    this.partial = buffer.slice(lineStart);
  }

  private processLine(line: string): void {
    if (line === '') {
      this.dispatch();
      return;
    }
    if (line.charCodeAt(0) === 58) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.charCodeAt(0) === 32) value = value.slice(1);
    switch (field) {
      case 'event':
        this.eventType = value;
        break;
      case 'data':
        this.dataLines.push(value);
        break;
      case 'id':
        if (!value.includes('\0')) this.idBuffer = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) this.handlers.onRetry?.(Number(value));
        break;
    }
  }

  private dispatch(): void {
    this.lastEventId = this.idBuffer;
    if (this.dataLines.length === 0) {
      this.eventType = '';
      return;
    }
    const message: StreamMessage = {
      id: this.idBuffer,
      event: this.eventType || 'message',
      data: this.dataLines.join('\n'),
    };
    this.dataLines = [];
    this.eventType = '';
    try {
      this.handlers.onMessage(message);
    } catch (error) {
      // A consumer bug must not tear down the stream and trigger a reconnect loop.
      console.error('event stream consumer failed', error);
    }
  }
}

export interface EventStreamOptions {
  url: string;
  onMessage: (message: StreamMessage) => void;
  onStatus?: (status: StreamStatus) => void;
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
  fetch?: typeof fetch;
  lastEventId?: string;
  /** Silence, heartbeat comments included, after which an open stream reports stale. */
  staleAfterMs?: number;
  /** Silence after which the connection is dropped and reopened from Last-Event-ID. */
  dropAfterMs?: number;
  /** Consecutive attempts that fail to open before the stream reports offline and stops. */
  maxAttempts?: number;
  backoffMs?: (failures: number, serverRetryMs: number | undefined) => number;
}

export interface EventStreamHandle {
  close(): void;
  /** Reconnect now with a fresh attempt budget, e.g. from an Offline banner's Retry. */
  retry(): void;
  readonly lastEventId: string;
}

class FatalStreamError extends Error {}

const defaultBackoff = (failures: number, serverRetryMs: number | undefined) =>
  Math.min(15_000, (serverRetryMs ?? 1_000) * 2 ** failures);

export function openEventStream(options: EventStreamOptions): EventStreamHandle {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  // The Gateway pings every 15 s: stale means one ping missed, drop means two.
  const staleAfterMs = options.staleAfterMs ?? 20_000;
  const dropAfterMs = options.dropAfterMs ?? 40_000;
  const maxAttempts = options.maxAttempts ?? 5;
  const backoffMs = options.backoffMs ?? defaultBackoff;

  let lastEventId = options.lastEventId ?? '';
  let serverRetryMs: number | undefined;
  let failures = 0;
  let closed = false;
  let status: StreamStatus | undefined;
  let controller: AbortController | undefined;
  // Cancelled directly on close(): a fetch implementation that ignores its abort signal must not
  // keep the read (and its drop timer) alive.
  let activeReader: ReadableStreamDefaultReader<string> | undefined;
  let generation = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const setStatus = (next: StreamStatus) => {
    if (next === status) return;
    status = next;
    options.onStatus?.(next);
  };

  const connect = async (): Promise<void> => {
    const current = ++generation;
    const attempt = new AbortController();
    controller = attempt;
    let opened = false;
    // A retry() or close() can replace this attempt while any await below is pending; a fetch
    // wrapper may even settle after abort. Nothing may touch status, events or the cursor after that.
    const replaced = () => closed || current !== generation;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;
    let dropTimer: ReturnType<typeof setTimeout> | undefined;
    const armTimers = () => {
      clearTimeout(staleTimer);
      clearTimeout(dropTimer);
      if (opened) {
        staleTimer = setTimeout(() => {
          if (current === generation && !closed) setStatus('stale');
        }, staleAfterMs);
      }
      dropTimer = setTimeout(() => attempt.abort(), dropAfterMs);
    };
    try {
      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      };
      const token = await options.getAccessToken?.();
      if (replaced()) return;
      if (token) headers.Authorization = `Bearer ${token}`;
      if (lastEventId) headers['Last-Event-ID'] = lastEventId;
      armTimers();
      const response = await doFetch(options.url, {
        headers,
        signal: attempt.signal,
        cache: 'no-store',
      });
      if (replaced()) {
        void response.body?.cancel().catch(() => {});
        return;
      }
      if (response.status === 403) throw new FatalStreamError('forbidden');
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok || !response.body || !contentType.includes('text/event-stream')) {
        throw new Error(`event stream open failed: HTTP ${response.status}`);
      }
      opened = true;
      failures = 0;
      setStatus('live');
      armTimers();
      const parser = new SseParser(
        {
          onMessage: options.onMessage,
          onRetry: (ms) => {
            serverRetryMs = ms;
          },
        },
        lastEventId,
      );
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      activeReader = reader;
      for (;;) {
        const { value, done } = await reader.read();
        if (replaced()) {
          void reader.cancel().catch(() => {});
          return;
        }
        if (done) break;
        armTimers();
        if (status === 'stale') setStatus('live');
        parser.push(value);
        lastEventId = parser.lastEventId;
      }
    } catch (error) {
      if (closed || current !== generation) return;
      if (error instanceof FatalStreamError) {
        setStatus('offline');
        return;
      }
    } finally {
      clearTimeout(staleTimer);
      clearTimeout(dropTimer);
    }
    // A retry() or close() may have replaced this attempt while it was settling.
    if (closed || current !== generation) return;
    if (!opened) failures++;
    if (failures >= maxAttempts) {
      setStatus('offline');
      return;
    }
    setStatus('reconnecting');
    reconnectTimer = setTimeout(() => void connect(), backoffMs(failures, serverRetryMs));
  };

  setStatus('connecting');
  void connect();

  return {
    close() {
      closed = true;
      clearTimeout(reconnectTimer);
      controller?.abort();
      void activeReader?.cancel().catch(() => {});
    },
    retry() {
      if (closed) return;
      clearTimeout(reconnectTimer);
      controller?.abort();
      failures = 0;
      setStatus('reconnecting');
      void connect();
    },
    get lastEventId() {
      return lastEventId;
    },
  };
}
