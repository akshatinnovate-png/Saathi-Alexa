import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEnv, setEnv, funnelAddress } from '../scripts/reach.js';

test('reach: the public address is written once and removed cleanly, leaving other settings alone', () => {
  const start = 'PORT=9000\nSAATHI_PUBLIC_URL=https://old.example\nANTHROPIC_API_KEY="sk-test"\n';
  const set = setEnv(start, 'SAATHI_PUBLIC_URL', 'https://aaji-pc.tail1a2b.ts.net');
  assert.deepEqual(readEnv(set), [['PORT', '9000'], ['ANTHROPIC_API_KEY', 'sk-test'], ['SAATHI_PUBLIC_URL', 'https://aaji-pc.tail1a2b.ts.net']]);
  const cleared = setEnv(set, 'SAATHI_PUBLIC_URL', null);
  assert.deepEqual(readEnv(cleared), [['PORT', '9000'], ['ANTHROPIC_API_KEY', 'sk-test']]);
  assert.equal(setEnv('', 'SAATHI_PUBLIC_URL', 'https://x.ts.net'), 'SAATHI_PUBLIC_URL=https://x.ts.net\n');
});

test('reach: only a real ts.net name becomes the address', () => {
  assert.equal(funnelAddress({ Self: { DNSName: 'Aaji-PC.tail1a2b.ts.net.' } }), 'https://aaji-pc.tail1a2b.ts.net');
  for (const DNSName of [undefined, '', 'evil.com.', 'aaji-pc.tail1a2b.ts.net.evil.com.', 'a b.ts.net.', 'x.ts.net/../evil']) {
    assert.equal(funnelAddress({ Self: { DNSName } }), null, String(DNSName));
  }
  assert.equal(funnelAddress(null), null);
});
