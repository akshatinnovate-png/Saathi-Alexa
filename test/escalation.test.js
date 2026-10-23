import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testServices } from './helpers.js';
import { loadDefinition } from '../src/escalation/interpreter.js';

test('ASL definition is valid JSON with substitutions applied and every Next resolvable', () => {
  const def = loadDefinition({ TableName: 'saathi', FamilyTopicArn: 'arn:aws:sns:us-east-1:1:t' });
  const json = JSON.stringify(def);
  assert.ok(!json.includes('${'));
  for (const [name, s] of Object.entries(def.States)) {
    for (const next of [s.Next, s.Default, ...(s.Choices ?? []).map((c) => c.Next)].filter(Boolean)) {
      assert.ok(def.States[next], `${name} -> ${next}`);
    }
  }
});

test('no acknowledgement: family, then neighbour, then emergency guidance', async () => {
  const { saathi, escalation, localBus, store } = testServices();
  const audiences = [];
  localBus.subscribe((e) => e['detail-type'] === 'NotificationSent' && audiences.push(e.detail.audience));
  const { alertId } = await saathi.requestHelp({ reason: 'I fell in the bathroom', urgency: 'critical' });
  await escalation.wait(alertId);
  assert.deepEqual(audiences, ['family', 'neighbour', 'everyone']);
  assert.equal((await store.get('alerts', alertId)).escalationStage, 'emergency-guidance-sent');
});

test('family acknowledgement stops the escalation and tells her someone is coming', async () => {
  let saathiRef;
  let alertIdRef;
  const { saathi, escalation, localBus, store } = testServices({
    sleep: async () => { await saathiRef.acknowledgeAlert({ alertId: alertIdRef, by: 'riya' }); },
  });
  saathiRef = saathi;
  const audiences = [];
  localBus.subscribe((e) => e['detail-type'] === 'NotificationSent' && audiences.push(e.detail.audience));
  const { alertId } = await saathi.requestHelp({ reason: 'dizzy and alone' });
  alertIdRef = alertId;
  await escalation.wait(alertId);
  assert.deepEqual(audiences, ['family']);
  assert.equal((await store.get('alerts', alertId)).escalationStage, 'resolved');
  const inbox = await saathi.familyMessages();
  assert.match(inbox.messages.at(-1).original, /रिया यांनी तुमचा निरोप पाहिला/);
});
