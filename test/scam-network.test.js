import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseFeed, activeWarnings, shareLink, createScamNetwork, PATTERN_KINDS } from '../src/domain/scamNetwork.js';
import { testServices } from './helpers.js';

const feedText = await readFile(new URL('../feeds/scam-patterns.json', import.meta.url), 'utf8');

test('the published feed is valid, reviewed-shaped and speaks English, Hindi and Marathi', () => {
  const warnings = parseFeed(feedText);
  assert.ok(warnings.length >= 5);
  for (const w of warnings) {
    assert.ok(w.say.en && w.say.hi && w.say.mr, w.id);
    assert.ok(w.kinds.every((k) => PATTERN_KINDS.includes(k)));
    assert.ok(!/\d{6,}/.test(Object.values(w.say).join(' ')), 'no phone numbers in warnings');
  }
});

test('bad entries are dropped and dates and countries decide what is active', () => {
  assert.throws(() => parseFeed({ version: 2, warnings: [] }), /Not a Saathi/);
  const list = parseFeed({ version: 1, warnings: [
    { id: 'ok', countries: ['IN'], kinds: ['bank', 'made-up'], from: '2026-01-01', until: '2026-12-31', title: { en: 'T', xx1: 'bad' }, say: { en: 'S' } },
    { id: 'everywhere', from: '2026-01-01', until: '2026-12-31', title: { en: 'T' }, say: { en: 'S' } },
    { id: 'Bad Id', from: '2026-01-01', until: '2026-12-31', title: { en: 'T' }, say: { en: 'S' } },
    { id: 'no-say', from: '2026-01-01', until: '2026-12-31', title: { en: 'T' }, say: {} },
    { id: 'no-date', title: { en: 'T' }, say: { en: 'S' } },
  ] });
  assert.deepEqual(list.map((w) => w.id), ['ok', 'everywhere']);
  assert.deepEqual(list[0].kinds, ['bank']);
  assert.deepEqual(activeWarnings(list, { country: 'IN', today: '2026-06-01' }).map((w) => w.id), ['ok', 'everywhere']);
  assert.deepEqual(activeWarnings(list, { country: 'US', today: '2026-06-01' }).map((w) => w.id), ['everywhere']);
  assert.deepEqual(activeWarnings(list, { country: 'IN', today: '2027-01-01' }), []);
});

test('the share link carries only kinds, country and language', () => {
  const link = shareLink({ kinds: ['code', 'bank', 'bank', 'not-a-kind'], country: 'IN', language: 'mr' });
  assert.deepEqual(link.kinds, ['bank', 'code']);
  const url = new URL(link.url);
  assert.equal(url.searchParams.get('labels'), 'scam-pattern');
  assert.match(url.searchParams.get('body'), /Kinds: bank, code/);
  assert.match(url.searchParams.get('body'), /Country: IN/);
  assert.match(shareLink({ kinds: [], country: 'x' }).url, /unknown/);
});

test('the feed is fetched carefully and a bad answer keeps the last good list', async () => {
  let reply = { ok: true, text: feedText };
  const warns = [];
  const net = createScamNetwork({ fetchImpl: async () => ({ ok: reply.ok, status: reply.ok ? 200 : 503, text: async () => reply.text }), log: { warn: (m) => warns.push(m) } });
  assert.ok((await net.refresh()) >= 5);
  const count = net.warnings.length;
  reply = { ok: false };
  assert.equal(await net.refresh(), null);
  reply = { ok: true, text: 'x'.repeat(300_000) };
  assert.equal(await net.refresh(), null);
  assert.equal(net.warnings.length, count);
  assert.equal(warns.length, 2);
  assert.ok(net.fetchedAt);
  assert.equal(createScamNetwork().load(feedText), count);
});

test('a household that opted in hears each warning once, in its own language, and can share the kinds it saw', async () => {
  const { saathi, localBus } = testServices();
  const heard = [];
  localBus.subscribe((e) => e['detail-type'] === 'ScamWarning' && heard.push(e.detail));
  const warnings = parseFeed(feedText);
  assert.deepEqual(await saathi.sweepScamWarnings(warnings), []);
  const off = await saathi.scamNetworkView(warnings);
  assert.deepEqual([off.settings.receive, off.warnings.length, off.share], [false, 0, null]);

  await saathi.updateProfile({ country: 'IN', scamNetwork: { receive: true, share: true } });
  const told = await saathi.sweepScamWarnings(warnings);
  assert.ok(told.length >= 5);
  assert.deepEqual(await saathi.sweepScamWarnings(warnings), []);
  assert.equal(heard[0].sayLanguage, 'mr');
  assert.match(heard[0].say, /OTP/);

  await saathi.reportSuspiciousCall({ words: 'The bank asked me for my OTP', language: 'en' });
  const view = await saathi.scamNetworkView(warnings);
  assert.ok(view.warnings.length >= 5);
  assert.ok(view.share.kinds.length >= 1);
  assert.ok(!view.share.url.includes('OTP'), 'the words she said are never shared');
});
