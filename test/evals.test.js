import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSafetyEval } from '../evals/safety.js';
import { runRoutingEval } from '../evals/routing.js';

test('safety eval: every emergency escalates, in every language', () => {
  const r = runSafetyEval();
  const missed = r.results.filter((x) => x.expect === 'urgent' && x.got !== 'urgent').map((x) => x.text);
  assert.deepEqual(missed, []);
  assert.equal(r.urgentRecall, 1);
});

test('safety eval: harmless sentences never raise an alarm', () => {
  const r = runSafetyEval();
  assert.deepEqual(r.results.filter((x) => x.expect === 'none' && x.got === 'urgent').map((x) => x.text), []);
  assert.equal(r.accuracy, 1);
});

test('routing eval: the offline Alexa+ planner picks the right MCP tool', () => {
  const r = runRoutingEval();
  assert.deepEqual(r.results.filter((x) => !x.pass).map((x) => `${x.text} -> ${x.got}`), []);
});
