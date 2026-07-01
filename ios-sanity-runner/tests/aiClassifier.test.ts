import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClassifyBody,
  parseClassifyResponse,
  createScreenClassifier,
  type FetchLike,
} from '../src/explore/aiClassifier.ts';

test('buildClassifyBody: puts the screenshot + element labels into a one-shot vision message', () => {
  const body = buildClassifyBody('claude-haiku-4-5', 'BASE64PNG', ['Search', 'फिल्में', '  ', 'शोज़']) as {
    model: string;
    max_tokens: number;
    messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
  };
  assert.equal(body.model, 'claude-haiku-4-5');
  assert.ok(body.max_tokens > 0);
  const content = body.messages[0]!.content;
  const image = content.find((b) => b.type === 'image') as { source: { type: string; media_type: string; data: string } };
  assert.equal(image.source.data, 'BASE64PNG');
  assert.equal(image.source.media_type, 'image/png');
  const textBlock = content.find((b) => b.type === 'text') as { text: string };
  assert.match(textBlock.text, /Search/);
  assert.match(textBlock.text, /फिल्में/);
  assert.doesNotMatch(textBlock.text, /,\s{2,},/); // blank label dropped, not left as empty item
  // No sampling / thinking / effort params on a plain classification call.
  assert.equal((body as Record<string, unknown>).temperature, undefined);
  assert.equal((body as Record<string, unknown>).thinking, undefined);
});

test('parseClassifyResponse: reads a clean JSON identity', () => {
  const id = parseClassifyResponse({ content: [{ type: 'text', text: '{"id":"home","title":"Home","isHome":true}' }] });
  assert.deepEqual(id, { id: 'home', title: 'Home', isHome: true });
});

test('parseClassifyResponse: tolerates a code fence and surrounding prose', () => {
  const text = 'Here is the screen:\n```json\n{"id": "search", "title": "Search", "isHome": false}\n```';
  const id = parseClassifyResponse({ content: [{ type: 'text', text }] });
  assert.deepEqual(id, { id: 'search', title: 'Search', isHome: false });
});

test('parseClassifyResponse: defaults isHome to false when absent or non-boolean', () => {
  const id = parseClassifyResponse({ content: [{ type: 'text', text: '{"id":"movies","title":"Movies"}' }] });
  assert.equal(id?.isHome, false);
});

test('parseClassifyResponse: returns null on unparseable / shapeless output', () => {
  assert.equal(parseClassifyResponse({ content: [{ type: 'text', text: 'no json here' }] }), null);
  assert.equal(parseClassifyResponse({ content: [{ type: 'text', text: '{"title":""}' }] }), null); // no usable id/title
  assert.equal(parseClassifyResponse({ content: [] }), null);
  assert.equal(parseClassifyResponse(null), null);
});

test('createScreenClassifier: returns null when disabled or no key (heuristic fallback)', () => {
  const f: FetchLike = async () => ({ ok: true, status: 200, text: async () => '{}' });
  assert.equal(createScreenClassifier(undefined, f), null);
  assert.equal(createScreenClassifier({ enabled: false, apiKey: 'k' }, f), null);
  assert.equal(createScreenClassifier({ enabled: true }, f), null); // enabled but no key
  assert.notEqual(createScreenClassifier({ enabled: true, apiKey: 'k' }, f), null);
});

test('classifier.classify: posts to the Messages API and returns the parsed identity', async () => {
  let seen: { url: string; headers: Record<string, string>; body: string } | undefined;
  const f: FetchLike = async (url, init) => {
    seen = { url, headers: init.headers, body: init.body };
    return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: '{"id":"home","title":"Home","isHome":true}' }] }) };
  };
  const c = createScreenClassifier({ enabled: true, apiKey: 'secret', model: 'claude-haiku-4-5' }, f)!;
  const id = await c.classify('B64', ['Search']);
  assert.deepEqual(id, { id: 'home', title: 'Home', isHome: true });
  assert.match(seen!.url, /\/v1\/messages$/);
  assert.equal(seen!.headers['x-api-key'], 'secret');
  assert.equal(seen!.headers['anthropic-version'], '2023-06-01');
});

test('classifier.classify: returns null on HTTP error or thrown fetch (never breaks the crawl)', async () => {
  const errStatus: FetchLike = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
  const c1 = createScreenClassifier({ enabled: true, apiKey: 'k' }, errStatus)!;
  assert.equal(await c1.classify('B64', []), null);

  const throws: FetchLike = async () => {
    throw new Error('network down');
  };
  const c2 = createScreenClassifier({ enabled: true, apiKey: 'k' }, throws)!;
  assert.equal(await c2.classify('B64', []), null);
});
