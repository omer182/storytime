import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, cleanup } from './testApp';

test.after(() => cleanup());

test('GET /api/health returns ok', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(typeof res.body.version, 'string');
});

test('GET /api/figures returns the seed deck with the required categories present', async () => {
  const res = await request(app).get('/api/figures');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.ok(res.body.length > 0);

  const categories = new Set(res.body.map((f: { category: string }) => f.category));
  for (const required of ['character', 'location', 'mood']) {
    assert.ok(categories.has(required), `expected at least one "${required}" figure in the deck`);
  }

  for (const figure of res.body) {
    assert.equal(typeof figure.uid, 'string');
    assert.equal(typeof figure.name, 'string');
    assert.equal(typeof figure.category, 'string');
  }
});
