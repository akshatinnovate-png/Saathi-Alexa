const DAY = 24 * 3600 * 1000;

export function localDate(ms, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const timesOf = (m) => (Array.isArray(m.times) && m.times.length ? m.times : [m.time]).filter(Boolean);
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
const avg = (xs) => {
  const v = xs.filter((x) => x !== null && x !== undefined);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

export function weekStats({ dates, medications, doses, checkins, door, orientations, alerts, timeZone }) {
  const inWeek = new Set(dates);
  const byDate = (iso) => inWeek.has(localDate(Date.parse(iso), timeZone));
  let expected = 0;
  let eveningExpected = 0;
  const perMed = {};
  for (const date of dates) {
    for (const m of medications) {
      if (m.days && !m.days.includes(weekdayOf(date))) continue;
      for (const t of timesOf(m)) {
        expected += 1;
        if (t >= '17:00') eveningExpected += 1;
        perMed[m.id] ??= { expected: 0, taken: 0 };
        perMed[m.id].expected += 1;
      }
    }
  }
  const taken = doses.filter((d) => inWeek.has(d.date));
  for (const d of taken) if (perMed[d.medicationId]) perMed[d.medicationId].taken += 1;
  const slotTime = (d) => {
    const m = medications.find((x) => x.id === d.medicationId);
    return m ? timesOf(m)[Number(d.slot) || 0] ?? timesOf(m)[0] : null;
  };
  const eveningTaken = taken.filter((d) => (slotTime(d) ?? '') >= '17:00').length;
  const checks = checkins.filter((c) => byDate(c.at));
  const low = checks.filter((c) => c.sentiment === 'NEGATIVE' || (c.concerns ?? []).length).length;
  return {
    from: dates[0], to: dates.at(-1),
    expectedDoses: expected, takenDoses: Math.min(taken.length, expected), adherence: pct(Math.min(taken.length, expected), expected),
    eveningMissed: Math.max(0, eveningExpected - eveningTaken),
    perMedication: Object.fromEntries(Object.entries(perMed).map(([id, v]) => [id, pct(Math.min(v.taken, v.expected), v.expected)])),
    checkins: checks.length, lowCheckins: low, privateCheckins: checks.filter((c) => c.private).length,
    doorDays: new Set(door.filter((e) => byDate(e.at)).map((e) => localDate(Date.parse(e.at), timeZone))).size,
    askedTime: orientations.filter((o) => byDate(o.at)).length,
    helpRequests: alerts.filter((a) => a.type === 'help' && byDate(a.createdAt)).length,
    scams: alerts.filter((a) => ['scam', 'scam-guard', 'scam-shield'].includes(a.type) && byDate(a.createdAt)).length,
  };
}

export function computeInsight({ now, timeZone, name, medications, doses, checkins, door, orientations, alerts, weeks = 4 }) {
  const list = [];
  for (let w = 0; w < weeks; w++) {
    const dates = [];
    for (let d = 6; d >= 0; d--) dates.push(localDate(now - (w * 7 + d) * DAY, timeZone));
    list.push(weekStats({ dates, medications, doses, checkins, door, orientations, alerts, timeZone }));
  }
  const [current, ...earlier] = list;
  const usual = (key) => avg(earlier.map((w) => w[key]));
  const base = { adherence: usual('adherence'), askedTime: usual('askedTime'), doorDays: usual('doorDays'), checkins: usual('checkins'), helpRequests: usual('helpRequests') };
  const round = (x) => (x === null ? null : Math.round(x));
  const changes = [];
  if (current.adherence !== null && current.adherence < 85 && (base.adherence === null || base.adherence - current.adherence >= 15)) {
    changes.push({ key: 'tablets', text: `Took ${current.adherence}% of tablets this week${base.adherence !== null ? `, compared with about ${round(base.adherence)}% usually` : ''}.` });
  }
  if (current.eveningMissed >= 3) changes.push({ key: 'evening', text: `Missed evening tablets ${current.eveningMissed} times this week.` });
  if (current.askedTime >= 5 && current.askedTime >= 2 * (base.askedTime ?? 0)) {
    changes.push({ key: 'orientation', text: `Asked Saathi for the day or time ${current.askedTime} times this week${base.askedTime ? `, more than usual (about ${round(base.askedTime)})` : ''}.` });
  }
  if (current.checkins >= 2 && current.lowCheckins / current.checkins >= 0.5) {
    changes.push({ key: 'mood', text: `Sounded low in ${current.lowCheckins} of ${current.checkins} check-ins.` });
  }
  if (current.checkins === 0 && (base.checkins ?? 0) >= 2) changes.push({ key: 'quiet', text: 'Did not check in with Saathi this week.' });
  if (base.doorDays !== null && base.doorDays - current.doorDays >= 3) changes.push({ key: 'door', text: `Front-door activity on ${current.doorDays} days, fewer than usual (about ${round(base.doorDays)}).` });
  if (current.helpRequests > Math.max(0, base.helpRequests ?? 0)) changes.push({ key: 'help', text: `Asked for help ${current.helpRequests} time${current.helpRequests === 1 ? '' : 's'} this week.` });
  const summary = changes.length
    ? `Some changes in ${name}'s week are worth mentioning to the doctor. Saathi only compares ${name} with ${name}'s own usual week; it does not diagnose.`
    : `No unusual changes in ${name}'s week compared with the weeks before.`;
  return { name, generatedAt: new Date(now).toISOString(), summary, changes, current, usual: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, round(v)])), weeks: list };
}
