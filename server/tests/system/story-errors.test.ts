import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, cleanup } from './testApp';

test.after(() => cleanup());

const UNKNOWN_STORY_ID = 'not-a-real-story-id';

test('GET /api/stories/:id 404s for an unknown story', async () => {
  const res = await request(app).get(`/api/stories/${UNKNOWN_STORY_ID}`);
  assert.equal(res.status, 404);
});

test('POST /api/stories/:id/figures 404s for an unknown story', async () => {
  const res = await request(app)
    .post(`/api/stories/${UNKNOWN_STORY_ID}/figures`)
    .send({ uid: 'whatever' });
  assert.equal(res.status, 404);
});

test('POST /api/stories/:id/figures 400s when uid is missing', async () => {
  const created = await request(app).post('/api/stories');
  const res = await request(app).post(`/api/stories/${created.body.id}/figures`).send({});
  assert.equal(res.status, 400);
});

test('POST /api/stories/:id/generate 404s for an unknown story', async () => {
  const res = await request(app).post(`/api/stories/${UNKNOWN_STORY_ID}/generate`);
  assert.equal(res.status, 404);
});

test('DELETE /api/stories/:id/figures/:entryId 404s for an unknown entry', async () => {
  const created = await request(app).post('/api/stories');
  const res = await request(app).delete(`/api/stories/${created.body.id}/figures/999999`);
  assert.equal(res.status, 404);
});
