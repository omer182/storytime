import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, cleanup } from './testApp';
import { generateStory, summaryOf, waitForIllustrations } from './illustrationHelpers';

test.after(() => cleanup());

test('regenerating a story drops the previous story\'s pictures', async () => {
  const { id } = await generateStory(app, true);
  await waitForIllustrations(app, id);

  const again = await request(app).post(`/api/stories/${id}/generate`).send({ generateImages: false });
  assert.equal(again.status, 200);
  const story = await request(app).get(`/api/stories/${id}`);
  assert.equal(story.body.images, undefined);
  assert.equal((await summaryOf(app, id)).coverUrl, null);
});

test('pictures are revalidated, so a re-rendered scene at the same URL is never served stale', async () => {
  const { id } = await generateStory(app, true);
  const [url] = await waitForIllustrations(app, id);
  const res = await request(app).get(url!);
  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /no-cache/);
  assert.doesNotMatch(res.headers['cache-control'], /immutable/);
});
