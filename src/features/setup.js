import { bad } from './media.js';

const RECOMMENDED = [
  {
    id: 'raksha',
    title: 'Fall checks',
    detail: 'With the Saathi Android app on her phone, Saathi asks "Are you all right?" after a likely fall and calls the family if she does not answer.',
    isOn: (elder) => Boolean(elder?.raksha?.enabled),
    turnOn: (elder) => ({ raksha: { stillness: false, stillHours: 3, from: '08:00', to: '20:00', ...(elder?.raksha ?? {}), enabled: true } }),
    restore: (before) => ({ raksha: { stillness: false, stillHours: 3, from: '08:00', to: '20:00', ...(before ?? {}), enabled: Boolean(before?.enabled) } }),
    snapshot: (elder) => elder?.raksha ?? null,
  },
  {
    id: 'scam-warnings',
    title: 'Scam warnings',
    detail: 'Saathi gently warns her about scams reported near her. Nothing about your family is shared.',
    isOn: (elder) => Boolean(elder?.scamNetwork?.receive),
    turnOn: (elder) => ({ scamNetwork: { receive: true, share: Boolean(elder?.scamNetwork?.share) } }),
    restore: (before) => ({ scamNetwork: { receive: Boolean(before?.receive), share: Boolean(before?.share) } }),
    snapshot: (elder) => elder?.scamNetwork ?? null,
  },
  {
    id: 'scam-shield',
    title: 'Scam Shield on her phone',
    detail: 'The Saathi Android app checks incoming texts and WhatsApp messages on her phone, with Gemma running on the phone itself, and warns her about scams. The messages never leave her phone.',
    isOn: (elder) => Boolean(elder?.scamShield?.enabled),
    turnOn: () => ({ scamShield: { enabled: true } }),
    restore: (before) => ({ scamShield: { enabled: Boolean(before?.enabled) } }),
    snapshot: (elder) => elder?.scamShield ?? null,
  },
];

const SEVERITY = { urgent: 0, soon: 1, info: 2 };

export function createSetup({ services, accounts = null, security = null, haq = null, clock = () => new Date() }) {
  const saathiFor = (householdId) => services.forHousehold(householdId);

  async function status(householdId, { email = null, role = 'family' } = {}) {
    const saathi = saathiFor(householdId);
    const [elder, circle, care, devices, account] = await Promise.all([
      saathi.elder(),
      saathi.circle(),
      saathi.careSetup().catch(() => null),
      accounts?.listDevices(householdId).catch(() => []) ?? [],
      email && security ? security.summary(email).catch(() => null) : null,
    ]);
    const medicines = care?.medications ?? [];
    const medical = elder?.medical ?? {};
    const steps = [
      { id: 'profile', title: `Tell Saathi about ${elder?.preferredName ?? 'them'}`, detail: 'Name, language, city and time zone.', done: Boolean(elder?.name && elder?.language && elder?.city), action: { label: 'Open settings', open: 'settings' } },
      { id: 'medicines', title: 'Add their tablets', detail: 'Photograph a prescription and Saathi fills in the list.', done: medicines.length > 0, action: { label: 'Scan a prescription', href: '#care/scan' } },
      { id: 'family', title: 'Invite family', detail: 'Everyone sees the same day, each in their own language.', done: circle.filter((p) => p.role !== 'elder').length > 1, action: { label: 'Invite someone', open: 'invite' } },
      { id: 'device', title: elder?.preferredName ? `Set up ${elder.preferredName}'s screen` : 'Set up their screen', detail: 'A six-digit code turns any tablet or old phone into their Saathi.', done: devices.length > 0, action: { label: 'Get a code', open: 'devices' } },
      { id: 'protection', title: 'Turn on recommended protection', detail: 'Fall checks, scam warnings and Scam Shield, in one tap.', done: RECOMMENDED.every((r) => r.isOn(elder)), action: { label: 'Review and turn on', open: 'recommended' } },
      { id: 'medical', title: 'Fill in the medical ID', detail: 'Allergies, conditions and who to call, for a paramedic.', done: Boolean(medical.conditions || medical.allergies || medical.familyPhone), action: { label: 'Open settings', open: 'settings' } },
    ];
    if (account) {
      steps.push({ id: 'sign-in', title: 'Protect your sign-in', detail: 'Add a fingerprint or face sign-in (a passkey), or a two-step code.', done: account.totp || account.passkeys.length > 0, action: { label: 'Open security', open: 'security' } });
    }
    const visible = role === 'neighbour' ? [] : steps;
    return { steps: visible, done: visible.filter((s) => s.done).length, total: visible.length };
  }

  async function attention(householdId, { memberId = null, role = 'family' } = {}) {
    const saathi = saathiFor(householdId);
    const summary = await saathi.familySummary({ forMemberId: memberId });
    const elder = await saathi.elder();
    const name = elder?.preferredName ?? 'them';
    const items = [];
    for (const a of summary.alerts.filter((x) => x.type === 'help' && !x.acknowledged)) {
      items.push({ id: `help-${a.id}`, severity: 'urgent', title: `${name} asked for help`, detail: a.reason ?? 'Someone needs to respond.', action: { label: "I'm on it", post: `/family/alerts/${a.id}/ack`, } });
    }
    if (role !== 'neighbour') {
      const missed = summary.medications.filter((m) => m.status === 'missed');
      if (missed.length) {
        items.push({ id: 'missed-tablets', severity: 'soon', title: `${missed.length} tablet${missed.length === 1 ? '' : 's'} not confirmed today`, detail: missed.map((m) => `${m.name} (${m.time})`).join(', '), action: { label: 'Send a reminder', href: '#messages' } });
      }
      const low = new Map();
      for (const m of summary.medications) if (m.daysLeft !== null && m.daysLeft !== undefined && m.daysLeft <= (m.supply?.lowAtDays ?? 5)) low.set(m.id, m);
      for (const m of low.values()) {
        items.push({ id: `refill-${m.id}`, severity: m.daysLeft <= 2 ? 'urgent' : 'soon', title: `${m.name}: ${m.daysLeft} day${m.daysLeft === 1 ? '' : 's'} left`, detail: 'Tap once it has been refilled.', action: { label: 'Refilled', post: '/family/refill', body: { medicationId: m.id } } });
      }
      const horizon = clock().getTime() + 7 * 24 * 3600 * 1000;
      for (const a of summary.appointments.filter((x) => !x.escort && Date.parse(x.at) <= horizon)) {
        items.push({ id: `escort-${a.id}`, severity: 'soon', title: `Nobody is taking ${name} to ${a.title}`, detail: `${a.at.slice(0, 10)} at ${a.at.slice(11, 16)}${a.with ? `, ${a.with}` : ''}`, action: memberId ? { label: "I'll take her", post: '/family/escort', body: { appointmentId: a.id } } : { label: 'See visits', href: '#care/appointments' } });
      }
      if (haq) {
        const view = await haq.view(householdId).catch(() => null);
        for (const b of view?.benefits ?? []) {
          if (b.status === 'late' || b.status === 'due') items.push({ id: `haq-${b.id}`, severity: b.status === 'late' ? 'urgent' : 'soon', title: b.title, detail: b.why ?? '', action: { label: 'See what to do', href: '#care/haq' } });
        }
      }
    }
    items.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
    return { items, count: items.length };
  }

  async function recommended(householdId) {
    const elder = await saathiFor(householdId).elder();
    return { changes: RECOMMENDED.map((r) => ({ id: r.id, title: r.title, detail: r.detail, on: r.isOn(elder) })) };
  }

  async function applyRecommended(householdId, ids = null) {
    const saathi = saathiFor(householdId);
    const elder = await saathi.elder();
    const wanted = RECOMMENDED.filter((r) => (Array.isArray(ids) ? ids.includes(r.id) : true) && !r.isOn(elder));
    const applied = [];
    const before = {};
    for (const r of wanted) {
      before[r.id] = r.snapshot(elder);
      await saathi.updateProfile(r.turnOn(elder));
      applied.push(r.id);
    }
    return { applied, undo: applied.length ? { before } : null, ...(await recommended(householdId)) };
  }

  async function undoRecommended(householdId, undo) {
    if (!undo || typeof undo.before !== 'object' || undo.before === null) throw bad('Nothing to undo.');
    const saathi = saathiFor(householdId);
    const restored = [];
    for (const r of RECOMMENDED) {
      if (!(r.id in undo.before)) continue;
      await saathi.updateProfile(r.restore(undo.before[r.id]));
      restored.push(r.id);
    }
    return { restored, ...(await recommended(householdId)) };
  }

  return { status, attention, recommended, applyRecommended, undoRecommended };
}
