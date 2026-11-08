import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImpact } from '../src/domain/impact.js';
import { createDidis, LESSONS, cardSvg, VISIT_MINUTES } from '../src/didis/didis.js';
import { testServices, fixedClock } from './helpers.js';

const sunita = { name: 'Sunita Pawar', phone: '+91 98220 11111', city: 'Pune', area: 'Kothrud', languages: ['mr', 'hi'], skills: ['escort', 'visit'], rates: { escort: 400, visit: 250 }, upiId: 'sunita@okaxis', partnerCode: 'SEWA-PUNE', safetyContact: { name: 'Lata (SHG)', phone: '9822099999' } };
const readyDidi = async (didis, input) => {
  const { didi, token } = await didis.signUp(input);
  for (const l of LESSONS) await didis.answerLesson(await didis.byToken(token), l.id, l.answer);
  return { didi, token, me: await didis.byToken(token) };
};

test('Didi safety: SOS, overdue visits, rating families, blocking, phone sign-in and the profile card', async () => {
  const services = testServices();
  const notes = [];
  services.localBus.subscribe((e) => e['detail-type'] === 'NotificationSent' && notes.push(e.detail));
  const events = [];
  let now = fixedClock();
  const images = { generate: async () => { throw new Error('quota'); } };
  const didis = createDidis({ store: services.store, services, images, onEvent: async (type, p) => { events.push([type, p]); }, clock: () => now, partnerCodes: ['SEWA-PUNE'] });
  await assert.rejects(didis.signUp({ ...sunita, safetyContact: { phone: '12' } }), /safety contact/);
  const { me } = await readyDidi(didis, sunita);
  assert.deepEqual(me.safetyContact, { name: 'Lata (SHG)', phone: '9822099999' });
  assert.equal(me.phoneVerified, false);

  const b = await didis.book('default', { kind: 'escort', at: '2026-10-24T10:00', didiId: me.id }, 'riya');
  assert.deepEqual(events.at(-1)[1].didiIds, [me.id]);
  const open = await didis.book('default', { kind: 'visit', at: '2026-10-25T10:00' }, 'riya');
  assert.deepEqual(events.at(-1)[1].didiIds, [me.id], 'nearby ready Didis hear about open requests');
  await assert.rejects(didis.sos(me, b.id), /accepted visit/);
  await didis.accept(me, b.id);
  const sos = await didis.sos(me, b.id, { note: 'मला मदत हवी', language: 'mr' });
  assert.deepEqual(sos.call.map((c) => c.number), ['112', '9822099999']);
  const alert = notes.find((n) => /needs help/.test(n.subject));
  assert.equal(alert.severity, 'critical');
  assert.match(alert.message, /Lata \(SHG\) on 9822099999/);
  assert.equal(events.find(([t]) => t === 'sos')[1].bookingId, b.id);

  await didis.checkIn(me, b.id);
  assert.equal(await didis.sweepOverdue(), 0);
  now = new Date(fixedClock().getTime() + (VISIT_MINUTES.escort + 1) * 60_000);
  assert.equal(await didis.sweepOverdue(), 1);
  assert.ok(notes.some((n) => /has not finished the visit/.test(n.subject)));
  assert.deepEqual(events.at(-1)[0], 'overdue');
  assert.equal(await didis.sweepOverdue(), 0, 'told once');

  await assert.rejects(didis.rateFamily(me, b.id, { stars: 5 }), /after the visit/);
  await didis.checkOut(me, b.id, { note: 'All good' });
  await assert.rejects(didis.rateFamily(me, b.id, { stars: 0 }), /1 to 5/);
  assert.deepEqual(await didis.rateFamily(me, b.id, { stars: 2, note: 'Rude', block: true }), { rated: 2, blocked: true });
  await assert.rejects(didis.rateFamily(me, b.id, { stars: 3 }), /already rated/);
  const fresh = await services.store.get('didis', me.id);
  assert.deepEqual(fresh.blockedHouseholds, ['default']);
  assert.ok(!(await didis.offers(fresh)).some((o) => o.id === open.id), 'a blocked family\'s requests no longer reach her');
  const other = (await readyDidi(didis, { ...sunita, name: 'Asha', phone: '9822033333', safetyContact: null })).me;
  const offer = (await didis.offers(other)).find((o) => o.id === open.id);
  assert.deepEqual(offer.familyRating, { stars: 2, count: 1 });
  assert.deepEqual((await didis.sos(other, b.id).catch((e) => e.message)), 'That booking is not yours.');

  assert.equal((await didis.byPhone('+919822011111')).id, me.id);
  assert.equal((await didis.byPhone('98220 11111')).id, me.id);
  assert.equal(await didis.byPhone(''), null);
  const token = await didis.newToken(fresh);
  assert.equal((await didis.byToken(token)).phoneVerified, true);
  await assert.rejects(didis.updateSafety(fresh, { phone: '1' }), /safety contact/);
  assert.deepEqual(await didis.updateSafety(fresh, { name: '', phone: '' }), { safetyContact: null });

  const card = await didis.card(await services.store.get('didis', me.id));
  assert.equal(card.contentType, 'image/svg+xml');
  assert.match(card.data.toString(), /Sunita Pawar/);
  assert.match(card.data.toString(), /Verified/);
  assert.match(cardSvg({ name: '<b>', area: '', skills: '', languages: '', visits: 0 }), /&lt;b&gt;/);
  const withImages = createDidis({ store: services.store, services, images: { generate: async (prompt) => ({ data: Buffer.from(prompt), contentType: 'image/png' }) } });
  const png = await withImages.card(await services.store.get('didis', me.id));
  assert.equal(png.contentType, 'image/png');
  assert.match(png.data.toString(), /Speaks Marathi, Hindi/);
});

test('the impact numbers count care, safety and Didi earnings without personal details', async () => {
  const services = testServices();
  const didis = createDidis({ store: services.store, services, clock: fixedClock, partnerCodes: ['SEWA-PUNE'] });
  const { me } = await readyDidi(didis, sunita);
  const b = await didis.book('default', { kind: 'visit', at: '2026-10-24T10:00', didiId: me.id });
  await didis.accept(me, b.id);
  await didis.checkIn(me, b.id);
  await didis.checkOut(me, b.id, { note: 'ok' });
  await didis.markPaid('default', b.id);
  await didis.rate('default', b.id, { stars: 5 });
  await services.saathi.requestHelp({ reason: 'fell', urgency: 'critical' });
  const impact = createImpact({ services, store: services.store, includeDemo: true, clock: fixedClock });
  const out = await impact.get();
  assert.equal(out.elders, 1);
  assert.equal(out.safety.helpRequests, 1);
  assert.deepEqual([out.didis.visits, out.didis.earned, out.didis.paid, out.didis.rating, out.didis.verified], [1, 250, 250, 5, 1]);
  assert.deepEqual(out.didis.byMonth, [{ month: '2026-10', visits: 1, earned: 250 }]);
  assert.deepEqual(out.didis.thisMonth, { visits: 1, earned: 250 });
  assert.ok(!JSON.stringify(out).includes('Sunita'), 'no names');
  assert.equal(await impact.get(), out, 'cached');
  const real = await createImpact({ services, store: services.store, clock: fixedClock }).get();
  assert.deepEqual([real.elders, real.didis.visits], [0, 0], 'the demo family is left out of real numbers');
});
