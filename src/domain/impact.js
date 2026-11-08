import { collectionFor, DEFAULT_HOUSEHOLD } from '../households/scope.js';

export function createImpact({ services, store, includeDemo = false, clock = () => new Date(), ttlMs = 60_000 }) {
  let cached = null;

  async function compute() {
    const ids = (await services.householdIds()).filter((id) => includeDemo || id !== DEFAULT_HOUSEHOLD);
    const t = { households: 0, tabletsConfirmed: 0, missedDosesCaught: 0, checkIns: 0, lowMoodNudges: 0, messages: 0, stories: 0, helpRequests: 0, helpAnswered: 0, scamsStopped: 0 };
    for (const id of ids) {
      const list = (c) => store.list(collectionFor(id, c));
      const [profile, doses, alerts, checkins, messages, stories, incidents] = await Promise.all([list('profile'), list('doses'), list('alerts'), list('checkins'), list('messages'), list('stories'), list('scamIncidents')]);
      if (!profile.some((p) => p.id === 'elder')) continue;
      t.households += 1;
      t.tabletsConfirmed += doses.length;
      t.missedDosesCaught += alerts.filter((a) => a.type === 'dose-missed').length;
      t.checkIns += checkins.length;
      t.lowMoodNudges += checkins.filter((c) => !c.private && (c.concerns ?? []).length).length;
      t.messages += messages.length;
      t.stories += stories.length;
      const help = alerts.filter((a) => a.type === 'help');
      t.helpRequests += help.length;
      t.helpAnswered += help.filter((a) => a.acknowledged).length;
      t.scamsStopped += incidents.length + alerts.filter((a) => a.type === 'scam').length;
    }
    const didis = await store.list('didis');
    const bookings = (await store.list('didiBookings')).filter((b) => includeDemo || b.householdId !== DEFAULT_HOUSEHOLD);
    const done = bookings.filter((b) => b.status === 'done');
    const ratings = didis.flatMap((d) => d.ratings ?? []);
    const month = clock().toISOString().slice(0, 7);
    const byMonth = {};
    for (const b of done) {
      const m = String(b.checkOutAt ?? '').slice(0, 7);
      if (!m) continue;
      byMonth[m] ??= { visits: 0, earned: 0 };
      byMonth[m].visits += 1;
      byMonth[m].earned += b.fee ?? 0;
    }
    return {
      updatedAt: clock().toISOString(),
      elders: t.households,
      care: { tabletsConfirmed: t.tabletsConfirmed, missedDosesCaught: t.missedDosesCaught, checkIns: t.checkIns, lowMoodNudges: t.lowMoodNudges, messages: t.messages, stories: t.stories },
      safety: { helpRequests: t.helpRequests, helpAnswered: t.helpAnswered, scamsStopped: t.scamsStopped },
      didis: {
        signedUp: didis.length,
        verified: didis.filter((d) => d.verified).length,
        visits: done.length,
        earned: done.reduce((s, b) => s + (b.fee ?? 0), 0),
        paid: done.filter((b) => b.paidAt).reduce((s, b) => s + (b.fee ?? 0), 0),
        thisMonth: byMonth[month] ?? { visits: 0, earned: 0 },
        rating: ratings.length ? Math.round((ratings.reduce((a, r) => a + r, 0) / ratings.length) * 10) / 10 : null,
        byMonth: Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([m, v]) => ({ month: m, ...v })),
      },
    };
  }

  return {
    async get() {
      if (cached && Date.now() - cached.at < ttlMs) return cached.value;
      cached = { at: Date.now(), value: await compute() };
      return cached.value;
    },
  };
}
