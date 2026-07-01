/**
 * Zero-dependency live dashboard server (Node's built-in `http`). It streams
 * {@link RunEvent}s to the browser over Server-Sent Events and serves the run
 * history the {@link RunStore} has on disk. No framework, no build step — it
 * fits the runner's native-TS, minimal-deps design.
 *
 * Routes:
 *   GET /                      the dashboard page
 *   GET /api/stream            SSE: a snapshot then live `{ type, run }` frames
 *   GET /api/runs              run history (summaries, newest first)
 *   GET /api/runs/:id          one run, full detail
 *   GET /api/current           the active run, full detail
 *   GET /api/capabilities      what the UI can trigger (states/targets/busy)
 *   POST /api/explore          start an exploratory crawl (delegates to onTrigger)
 *   POST /api/stop             abort the in-progress run (delegates to onStop)
 *   GET /artifacts/<path>      screenshots / page source (sandboxed)
 */
import http from 'node:http';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { EventHub, RunEvent } from '../events/runEvents.ts';
import type { RunStore, StoredRun } from './runStore.ts';
import { DASHBOARD_HTML } from './ui.ts';

export interface DashboardHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/** A request from the UI's trigger button. */
export interface TriggerRequest {
  mode: string;
  state?: string;
  target?: string;
}

/** The host's answer: started (ok+runId), busy (409), or refused (error). */
export interface TriggerResult {
  ok: boolean;
  runId?: string;
  error?: string;
  busy?: boolean;
}

/** What the UI may offer — drives the control panel; `busy` is point-in-time. */
export interface DashboardCapabilities {
  trigger: boolean;
  states: string[];
  targets: string[];
  defaultState: string;
  defaultTarget: string;
}

export interface DashboardOptions {
  hub: EventHub;
  store: RunStore;
  port: number;
  artifactsDir: string;
  /** Start a run from the UI. Absent => the trigger button is disabled. */
  onTrigger?: (req: TriggerRequest) => Promise<TriggerResult>;
  /** Abort the in-progress run; returns whether one was actually stopped. */
  onStop?: () => boolean;
  /** Static capability advertisement for the control panel. */
  capabilities?: DashboardCapabilities;
}

const MAX_BODY_BYTES = 64 * 1024;
// A whole-run ingest carries every suite + step, so it needs a larger cap than
// a trigger request; single events stay well under the 64K default.
const MAX_INGEST_BYTES = 4 * 1024 * 1024;

const RUN_EVENT_TYPES = new Set<string>([
  'run_started',
  'suite_started',
  'step_finished',
  'suite_finished',
  'run_finished',
]);

/** Resolves the request body, or `null` if it exceeds the cap (caller → 413). */
function readBody(req: http.IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<string | null> {
  return new Promise<string | null>((resolveBody) => {
    let data = '';
    let over = false;
    req.on('data', (chunk: Buffer) => {
      if (over) return;
      data += chunk.toString('utf8');
      if (data.length > maxBytes) over = true;
    });
    req.on('end', () => resolveBody(over ? null : data));
    req.on('error', () => resolveBody(''));
  });
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.xml': 'application/xml; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function runSummary(run: StoredRun): Omit<StoredRun, 'suites'> & { suites: number } {
  const { suites, ...rest } = run;
  return { ...rest, suites: suites.length };
}

export function startDashboard(opts: DashboardOptions): Promise<DashboardHandle> {
  const { hub, store, port, artifactsDir, onTrigger, onStop, capabilities } = opts;
  const artifactsRoot = resolve(artifactsDir);
  const clients = new Set<http.ServerResponse>();

  const broadcast = (payload: unknown): void => {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
      if (res.writableEnded) {
        clients.delete(res);
        continue;
      }
      try {
        res.write(frame);
      } catch {
        clients.delete(res); // a dead client also clears on its own 'close'
      }
    }
  };

  // Store is subscribed before us (see CLI), so by the time we read it back the
  // run already reflects this event. We resend the whole run so the client never
  // has to reduce events itself — the server stays the single source of truth.
  const unsubscribe = hub.subscribe((event: RunEvent) => {
    broadcast({ type: event.type, runId: event.runId, run: store.getRun(event.runId) });
  });

  const sendJson = (res: http.ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  const handleExplore = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    if (!onTrigger) {
      sendJson(res, 400, { ok: false, error: 'triggering is not enabled on this server' });
      return;
    }
    const raw = await readBody(req);
    if (raw === null) {
      sendJson(res, 413, { ok: false, error: 'request body too large' });
      return;
    }
    let body: TriggerRequest;
    try {
      body = raw ? (JSON.parse(raw) as TriggerRequest) : { mode: 'explore' };
    } catch {
      sendJson(res, 400, { ok: false, error: 'invalid JSON body' });
      return;
    }
    let result: TriggerResult;
    try {
      result = await onTrigger({ mode: body.mode ?? 'explore', state: body.state, target: body.target });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    sendJson(res, result.ok ? 202 : result.busy ? 409 : 400, result);
  };

  // Live wire-up for external run producers (e.g. the autonomous exploratory
  // loop): emit one RunEvent into the SAME hub the engine uses. The subscribed
  // RunStore persists it and our SSE subscriber streams it to browsers — so an
  // external run appears and updates in real time, identical to an engine run.
  const handleEvent = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const raw = await readBody(req);
    if (raw === null) {
      sendJson(res, 413, { ok: false, error: 'request body too large' });
      return;
    }
    let event: RunEvent;
    try {
      event = JSON.parse(raw || 'null') as RunEvent;
    } catch {
      sendJson(res, 400, { ok: false, error: 'invalid JSON body' });
      return;
    }
    const type = (event as { type?: unknown } | null)?.type;
    const runId = (event as { runId?: unknown } | null)?.runId;
    if (!event || typeof event !== 'object' || typeof type !== 'string' || !RUN_EVENT_TYPES.has(type) || typeof runId !== 'string') {
      sendJson(res, 400, { ok: false, error: 'not a valid RunEvent' });
      return;
    }
    hub.emit(event);
    sendJson(res, 202, { ok: true, runId });
  };

  // Whole-run push: accept a complete StoredRun, import it, and broadcast so
  // open browsers refresh. A convenience over emitting the full event sequence
  // when the producer already has the assembled run (e.g. a ledger export).
  const handleIngest = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const raw = await readBody(req, MAX_INGEST_BYTES);
    if (raw === null) {
      sendJson(res, 413, { ok: false, error: 'request body too large' });
      return;
    }
    let run: StoredRun;
    try {
      run = JSON.parse(raw || 'null') as StoredRun;
    } catch {
      sendJson(res, 400, { ok: false, error: 'invalid JSON body' });
      return;
    }
    if (!run || typeof run.id !== 'string' || !Array.isArray(run.suites)) {
      sendJson(res, 400, { ok: false, error: 'not a valid StoredRun' });
      return;
    }
    store.importRun(run);
    broadcast({ type: 'run_finished', runId: run.id, run: store.getRun(run.id) });
    sendJson(res, 202, { ok: true, runId: run.id });
  };

  // Canonicalize through symlinks before the containment check, so a symlink
  // planted inside artifactsDir can't escape it. realpath also collapses the
  // /var, /tmp → /private symlinks macOS uses, avoiding false rejections.
  const serveArtifact = (res: http.ServerResponse, rawPath: string): void => {
    // Decode each segment independently — the UI percent-encodes per segment,
    // so a single decodeURIComponent on the whole path would mishandle an
    // encoded slash. realpath + the containment check below still sandbox it.
    const rel = rawPath.split('/').map((seg) => decodeURIComponent(seg)).join('/');
    let root: string;
    let file: string;
    try {
      root = realpathSync(artifactsRoot);
      file = realpathSync(resolve(artifactsRoot, rel));
    } catch {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (file !== root && !file.startsWith(root + sep)) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }
    if (!statSync(file).isFile()) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'POST') {
      if (path === '/api/explore') {
        void handleExplore(req, res);
        return;
      }
      if (path === '/api/stop') {
        sendJson(res, 200, { stopped: onStop ? onStop() : false });
        return;
      }
      if (path === '/api/runs/event') {
        void handleEvent(req, res);
        return;
      }
      if (path === '/api/runs/ingest') {
        void handleIngest(req, res);
        return;
      }
    }

    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    if (path === '/api/capabilities') {
      sendJson(res, 200, capabilities ?? { trigger: false, states: [], targets: [], defaultState: '', defaultTarget: '' });
      return;
    }

    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DASHBOARD_HTML);
      return;
    }

    if (path === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      res.write(`data: ${JSON.stringify({ type: 'snapshot', run: store.current() })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* cleaned up on close */
        }
      }, 25_000);
      ping.unref(); // never let the heartbeat alone keep the process alive
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }

    if (path === '/api/runs') {
      sendJson(res, 200, store.listRuns().map(runSummary));
      return;
    }

    if (path === '/api/current') {
      sendJson(res, 200, store.current());
      return;
    }

    if (path.startsWith('/api/runs/')) {
      const run = store.getRun(decodeURIComponent(path.slice('/api/runs/'.length)));
      if (!run) sendJson(res, 404, { error: 'not found' });
      else sendJson(res, 200, run);
      return;
    }

    if (path.startsWith('/artifacts/')) {
      serveArtifact(res, path.slice('/artifacts/'.length));
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });

  const close = (): Promise<void> =>
    new Promise<void>((resolveClose) => {
      unsubscribe();
      for (const res of clients) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
      clients.clear();
      // Force-destroy any keep-alive sockets so close() can't hang on a browser
      // still holding the SSE stream open; the timeout is the final backstop.
      (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      const fallback = setTimeout(() => resolveClose(), 3000);
      fallback.unref();
      server.close(() => {
        clearTimeout(fallback);
        resolveClose();
      });
    });

  return new Promise<DashboardHandle>((resolveStart, rejectStart) => {
    const onError = (err: Error): void => rejectStart(err);
    server.once('error', onError);
    server.listen(port, () => {
      server.removeListener('error', onError);
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr !== null ? addr.port : port;
      resolveStart({ url: `http://localhost:${boundPort}`, port: boundPort, close });
    });
  });
}
