import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

// must be set before testApp pulls in config
process.env.MOCK_IMAGE_FAIL_SCENES = '0';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { app, cleanup } = require('./testApp') as typeof import('./testApp');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generateStory, summaryOf, waitForIllustrations } = require('./illustrationHelpers') as typeof import('./illustrationHelpers');

test.after(() => cleanup());

test('a failed opening scene leaves a gap and the cover comes from the next one', async () => {
  const { id } = await generateStory(app, true);
  const images = await waitForIllustrations(app, id);
  assert.equal(images[0], null);
  assert.match(images[1]!, /1\.webp$/);

  const { coverUrl } = await summaryOf(app, id);
  assert.ok(coverUrl);
  assert.equal((await request(app).get(coverUrl)).status, 200);
});
