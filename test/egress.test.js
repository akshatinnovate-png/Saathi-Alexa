import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { installEgressGuard, guardedLookup, hostAllowed, isPrivate, DEFAULT_ALLOW } from '../src/security/egress.js';

test('only the services Saathi uses are allowed', () => {
  for (const host of ['api.anthropic.com', 'oauth2.googleapis.com', 'gmail.googleapis.com', 'dynamodb.us-east-1.amazonaws.com', 'api.pwnedpasswords.com', 'api.ring.com', 'localhost', '127.0.0.1', '::1']) {
    assert.ok(hostAllowed(host, DEFAULT_ALLOW), host);
  }
  for (const host of ['evil.example', 'googleapis.com.evil.example', 'notamazonaws.com', 'amazonaws.com', '169.254.169.254', '10.0.0.1', '8.8.8.8', '', 'ring.com.attacker.io']) {
    assert.equal(hostAllowed(host, DEFAULT_ALLOW), false, host);
  }
  for (const ip of ['10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::ffff:10.0.0.1', 'fd00::1', 'fe80::1', '0.0.0.0']) assert.ok(isPrivate(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.equal(isPrivate(ip), false, ip);
});

test('blocked connections fail fast, real local ones still work, and DNS rebinding is refused', async () => {
  const server = http.createServer((_q, r) => r.end('ok')).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const guard = installEgressGuard({ env: {} });
  try {
    assert.equal(await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text(), 'ok');
    await assert.rejects(fetch('https://evil.example/'), (err) => /blocked a connection to evil\.example/.test(err.cause?.message ?? err.message));
    await assert.rejects(fetch('http://169.254.169.254/latest/meta-data/'), (err) => /169\.254\.169\.254/.test(err.cause?.message ?? err.message));
    const viaHttps = await new Promise((resolve) => https.get('https://attacker.example/', () => resolve('connected')).on('error', (e) => resolve(e.code)));
    assert.equal(viaHttps, 'ESAATHIEGRESS');
    assert.deepEqual([...guard.blocked.keys()].sort(), ['169.254.169.254', 'attacker.example', 'evil.example']);
    const rebound = await new Promise((resolve) => guardedLookup((h, o, cb) => cb(null, '10.0.0.5', 4))('api.anthropic.com', {}, (err) => resolve(err)));
    assert.equal(rebound.code, 'ESAATHIEGRESS');
    const fine = await new Promise((resolve) => guardedLookup((h, o, cb) => cb(null, '160.79.104.10', 4))('api.anthropic.com', {}, (err, a) => resolve(err ?? a)));
    assert.equal(fine, '160.79.104.10');
  } finally {
    guard.uninstall();
    server.close();
  }
});
