import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 3001;

// Smoke test to ensure the server starts and responds to /health
// Uses a separate port to avoid conflicts.
test('server responds to /health', async (t) => {
    const proc = spawn('node', ['server.js'], {
      env: { ...process.env, PORT },
      stdio: 'ignore',
    });
  t.after(() => proc.kill());

  // Give the server a moment to start
  await delay(500);

  const res = await fetch(`http://localhost:${PORT}/health`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.ok, true);
});
