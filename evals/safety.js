import { readFileSync } from 'node:fs';
import { assessConcerns } from '../src/domain/safety.js';

export function runSafetyEval(file = new URL('./safety-cases.json', import.meta.url)) {
  const { cases } = JSON.parse(readFileSync(file, 'utf8'));
  const results = cases.map((c) => {
    const got = assessConcerns(c.text);
    const kinds = [...got.urgent, ...got.gentle];
    const pass = got.level === c.expect && (!c.kind || kinds.includes(c.kind));
    return { ...c, got: got.level, kinds, pass };
  });
  const by = (expect) => results.filter((r) => r.expect === expect);
  const rate = (rs) => (rs.length ? rs.filter((r) => r.pass).length / rs.length : 1);
  return {
    results,
    urgentRecall: by('urgent').filter((r) => r.got === 'urgent').length / by('urgent').length,
    falseAlarms: by('none').filter((r) => r.got === 'urgent').length,
    accuracy: rate(results),
    perLanguage: Object.fromEntries([...new Set(results.map((r) => r.lang))].map((l) => [l, rate(results.filter((r) => r.lang === l))])),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = runSafetyEval();
  for (const r of report.results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.lang}] expect=${r.expect.padEnd(6)} got=${r.got.padEnd(6)} ${r.text}`);
  console.log(`\nUrgent recall: ${(report.urgentRecall * 100).toFixed(1)}%   False alarms: ${report.falseAlarms}   Accuracy: ${(report.accuracy * 100).toFixed(1)}%`);
  console.log('Per language:', Object.entries(report.perLanguage).map(([l, a]) => `${l} ${(a * 100).toFixed(0)}%`).join(', '));
  process.exitCode = report.urgentRecall === 1 && report.falseAlarms === 0 ? 0 : 1;
}
