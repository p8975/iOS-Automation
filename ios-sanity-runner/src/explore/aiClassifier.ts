/**
 * OPTIONAL AI screen-identification layer. Given a screenshot + the screen's
 * interactive-element labels, a vision model returns a stable screen identity
 * (id, human title, and whether it's the app ROOT/home). This is where heuristics
 * hit their ceiling: STAGE's home has no stable text marker (content varies per
 * session), so reset-to-home detection was the crawl's reliability bottleneck —
 * a model can judge "is this home?" across content variants where a substring
 * match can't.
 *
 * Fully optional and fail-safe: with no API key (or ai.enabled=false) the factory
 * returns null and the crawler falls back to its existing heuristics, unchanged.
 * Any network/parse error returns null too — the AI only ever ADDS signal.
 *
 * Uses native fetch (the repo's HTTP style — see stateDetector.ts) rather than the
 * Anthropic SDK, to avoid adding a dependency; a single classification call is a
 * trivial raw request.
 */
import type { ScreenIdentity } from './crawler.ts';

export interface ScreenClassifier {
  /** Identify the current screen, or null if the model is unavailable / errored. */
  classify(screenshotBase64: string, elements: readonly string[]): Promise<ScreenIdentity | null>;
}

/** AI config (config/runner.config.yaml → `ai:`). Disabled unless enabled AND a key resolves. */
export interface AiConfig {
  enabled?: boolean;
  /** API key; falls back to the ANTHROPIC_API_KEY env var when omitted. */
  apiKey?: string;
  /** Vision model id. Default: a fast, cheap Haiku (this runs per new screen). */
  model?: string;
  /** API base, override for a proxy/gateway. Default: https://api.anthropic.com */
  baseUrl?: string;
}

const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const MAX_ELEMENTS_IN_PROMPT = 30;

/** The minimal shape of `fetch` this module needs — injectable so it's unit-testable. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Build the Messages API request body for one screen classification. Pure, so it
 * is unit-tested. No thinking / effort / sampling params — a Haiku classification
 * is a plain one-shot vision call.
 */
export function buildClassifyBody(model: string, screenshotBase64: string, elements: readonly string[]): unknown {
  const labels = elements.filter((l) => l.trim().length > 0).slice(0, MAX_ELEMENTS_IN_PROMPT);
  const prompt =
    'You are a mobile-app QA assistant looking at ONE screen of an iOS app (STAGE, a Hindi OTT streaming app). ' +
    'Identify the screen from the screenshot and its visible interactive elements.\n\n' +
    'Visible elements: ' + (labels.length ? labels.join(', ') : '(none detected)') + '\n\n' +
    'Reply with ONLY a JSON object, no prose, no code fence:\n' +
    '{"id": "<short_snake_case_screen_id>", "title": "<short human title>", "isHome": <true|false>}\n\n' +
    'isHome is true ONLY for the app\'s main/home landing screen — the root a user returns to (the tab bar\'s Home tab, ' +
    'showing content rails, category chips, and a hero banner). It is false for search, a category/genre list, a title ' +
    'detail page, a video player, settings, or any permission/system dialog.';
  return {
    model,
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  };
}

/**
 * Parse a Messages API response into a ScreenIdentity, or null if it can't be
 * read. Pure, so it is unit-tested. Tolerates a ```json code fence and stray
 * prose around the JSON object.
 */
export function parseClassifyResponse(apiJson: unknown): ScreenIdentity | null {
  const blocks = (apiJson as { content?: unknown })?.content;
  if (!Array.isArray(blocks)) return null;
  const textBlock = blocks.find((b) => (b as { type?: unknown })?.type === 'text');
  const text = (textBlock as { text?: unknown })?.text;
  if (typeof text !== 'string') return null;
  const match = /\{[\s\S]*\}/.exec(text); // first {...} object, fence or prose tolerated
  if (!match) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const o = obj as { id?: unknown; title?: unknown; isHome?: unknown };
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : undefined;
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : title;
  if (!id || !title) return null;
  return { id, title, isHome: o.isHome === true };
}

class AnthropicScreenClassifier implements ScreenClassifier {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;

  constructor(apiKey: string, model: string, baseUrl: string, fetchImpl: FetchLike) {
    this.#apiKey = apiKey;
    this.#model = model;
    this.#baseUrl = baseUrl;
    this.#fetch = fetchImpl;
  }

  async classify(screenshotBase64: string, elements: readonly string[]): Promise<ScreenIdentity | null> {
    try {
      const res = await this.#fetch(this.#baseUrl.replace(/\/$/, '') + '/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.#apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildClassifyBody(this.#model, screenshotBase64, elements)),
      });
      if (!res.ok) return null;
      return parseClassifyResponse(JSON.parse(await res.text()));
    } catch {
      return null; // never let a classifier hiccup break the crawl — heuristics take over
    }
  }
}

/**
 * Build a classifier from config, or null when disabled / no key resolves (→ the
 * crawler runs its heuristics unchanged). `fetchImpl` is injectable for tests;
 * defaults to the global fetch.
 */
export function createScreenClassifier(cfg: AiConfig | undefined, fetchImpl?: FetchLike): ScreenClassifier | null {
  if (!cfg?.enabled) return null;
  const apiKey = cfg.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!f) return null;
  return new AnthropicScreenClassifier(apiKey, cfg.model ?? DEFAULT_MODEL, cfg.baseUrl ?? DEFAULT_BASE_URL, f);
}
