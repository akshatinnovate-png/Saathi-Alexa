import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const bin = fileURLToPath(new URL('../bin/saathi-mcp.js', import.meta.url));

test('the stdio demo server lists every tool and answers with the demo family', async () => {
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [bin], env: { ...process.env, SAATHI_METRICS: 'off' }, stderr: 'ignore' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 18);
    assert.ok(tools.every((t) => t.annotations && typeof t.annotations.readOnlyHint === 'boolean'));
    const day = await client.callTool({ name: 'what_day_is_it', arguments: { language: 'en' } });
    assert.ok(!day.isError);
    assert.ok(day.structuredContent.say.length > 0);
    const meds = await client.callTool({ name: 'get_medication_schedule', arguments: { language: 'en' } });
    assert.ok(meds.structuredContent.medications.length > 0);
    const taken = await client.callTool({ name: 'confirm_medication_taken', arguments: { language: 'en' } });
    assert.ok(!taken.isError);
  } finally {
    await client.close();
  }
});
