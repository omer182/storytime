import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import request from 'supertest';
import sharp from 'sharp';
import { app, cleanup, imagesPath } from './testApp';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('../../src/services/illustrationStore') as typeof import('../../src/services/illustrationStore');

test.after(() => cleanup());

async function generatedStoryId(): Promise<string> {
  const figures = (await request(app).get('/api/figures')).body as { uid: string; category: string }[];
  const created = await request(app).post('/api/stories');
  for (const category of ['character', 'location', 'mood']) {
    const uid = figures.find((f) => f.category === category)!.uid;
    await request(app).post(`/api/stories/${created.body.id}/figures`).send({ uid });
  }
  const generated = await request(app).post(`/api/stories/${created.body.id}/generate`).send({ generateImages: false });
  assert.equal(generated.status, 200);
  return created.body.id;
}

async function webpDataUrl(): Promise<string> {
  const buf = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#d4a24a' } }).webp().toBuffer();
  return `data:image/webp;base64,${buf.toString('base64')}`;
}

test('saved scene is served as webp with immutable cache', async () => {
  const id = await generatedStoryId();
  await store.saveScene(id, 0, await webpDataUrl());
  const res = await request(app).get(`/api/stories/${id}/images/0.webp`).buffer(true);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /image\/webp/);
  assert.match(res.headers['cache-control'], /immutable/);
  assert.equal(Buffer.from(res.body).subarray(8, 12).toString('ascii'), 'WEBP');
});

test('cover is 384 wide', async () => {
  const id = await generatedStoryId();
  await store.saveScene(id, 0, await webpDataUrl());
  await store.saveCover(id, 0);
  const meta = await sharp(path.join(imagesPath, id, 'cover.webp')).metadata();
  assert.equal(meta.width, 384);
});

test('story and summary expose recorded images', async () => {
  const id = await generatedStoryId();
  store.setStoryImages(id, { scenes: [true, false, true], cover: true });
  const story = await request(app).get(`/api/stories/${id}`);
  assert.deepEqual(story.body.images, [`/api/stories/${id}/images/0.webp`, null, `/api/stories/${id}/images/2.webp`]);
  const list = await request(app).get('/api/stories');
  const summary = list.body.find((s: { id: string }) => s.id === id);
  assert.equal(summary.coverUrl, `/api/stories/${id}/images/cover.webp`);
});

test('story without a record has no images', async () => {
  const id = await generatedStoryId();
  const story = await request(app).get(`/api/stories/${id}`);
  assert.equal(story.body.images, undefined);
  const list = await request(app).get('/api/stories');
  assert.equal(list.body.find((s: { id: string }) => s.id === id).coverUrl, null);
});

test('rejects traversal and unknown files', async () => {
  const id = await generatedStoryId();
  for (const url of [
    `/api/stories/${id}/images/..%2F..%2Fstories.db`,
    `/api/stories/${id}/images/3.webp`,
    `/api/stories/${id}/images/0.png`,
    `/api/stories/${id}/images/1.webp`, // valid name, but never saved
    '/api/stories/not-a-uuid/images/0.webp',
  ]) {
    const res = await request(app).get(url);
    assert.equal(res.status, 404, url);
    assert.deepEqual(res.body, { error: 'image not found' }, url);
  }
});
