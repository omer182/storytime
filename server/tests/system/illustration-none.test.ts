import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

// must be set before testApp pulls in config
process.env.MOCK_IMAGE_FAIL_SCENES = '0,1,2';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { app, cleanup } = require('./testApp') as typeof import('./testApp');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generateStory, summaryOf, waitForIllustrations } = require('./illustrationHelpers') as typeof import('./illustrationHelpers');

test.after(() => cleanup());

test('when every scene fails there is no cover', async () => {
  const { id } = await generateStory(app, true);
  const images = await waitForIllustrations(app, id);
  assert.deepEqual(images, [null, null, null]);
  assert.equal((await summaryOf(app, id)).coverUrl, null);
  const story = await request(app).get(`/api/stories/${id}`);
  assert.deepEqual(story.body.images, [null, null, null]);
});
