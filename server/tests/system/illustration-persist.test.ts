import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, cleanup } from './testApp';
import { generateStory, summaryOf, waitForIllustrations } from './illustrationHelpers';

test.after(() => cleanup());

test('illustrations are persisted and served once generated', async () => {
  const { id, body } = await generateStory(app, true);
  assert.equal(body.imagesPending, true);

  // history fetched while the pictures are still rendering must not point at a missing cover
  assert.equal((await summaryOf(app, id)).coverUrl, null);

  const images = await waitForIllustrations(app, id);
  assert.equal(images.length, 3);
  for (const url of images) {
    assert.match(url!, /^\/api\/stories\/.+\/images\/[012]\.webp$/);
    const res = await request(app).get(url!);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /image\/webp/);
  }

  const story = await request(app).get(`/api/stories/${id}`);
  assert.deepEqual(story.body.images, images);
  assert.match((await summaryOf(app, id)).coverUrl!, /cover\.webp$/);
});

test('a story generated without pictures has none', async () => {
  const { id, body } = await generateStory(app, false);
  assert.equal(body.imagesPending, undefined);
  const story = await request(app).get(`/api/stories/${id}`);
  assert.equal(story.body.images, undefined);
  assert.equal((await summaryOf(app, id)).coverUrl, null);
});
