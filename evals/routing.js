import { readFileSync } from 'node:fs';
import { planOffline } from '../src/agent/offlinePlanner.js';

export function runRoutingEval(file = new URL('./routing-cases.json', import.meta.url)) {
  const { cases } = JSON.parse(readFileSync(file, 'utf8'));
  const results = cases.map((c) => {
    const plan = planOffline(c.text, c.lang);
    const argsMatch = !c.args || Object.entries(c.args).every(([k, v]) => plan?.args?.[k] === v);
    return { ...c, got: plan?.tool ?? null, pass: (plan?.tool ?? null) === c.tool && argsMatch };
  });
  return { results, accuracy: results.filter((r) => r.pass).length / results.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = runRoutingEval();
  for (const r of report.results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.lang}] ${String(r.tool).padEnd(26)} got=${String(r.got).padEnd(26)} ${r.text}`);
  console.log(`\nRouting accuracy: ${(report.accuracy * 100).toFixed(1)}%`);
  process.exitCode = report.accuracy === 1 ? 0 : 1;
}
