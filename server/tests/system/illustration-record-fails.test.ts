import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import request from 'supertest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { app, cleanup, dbPath, imagesPath } = require('./testApp') as typeof import('./testApp');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generateStory, summaryOf, waitForIllustrations } = require('./illustrationHelpers') as typeof import('./illustrationHelpers');

test.after(() => cleanup());

test('when the images record cannot be written, the saved files are removed', async () => {
  // stands in for a full disk or a locked db: recording a story's images throws
  const other = new Database(dbPath);
  other.exec(`CREATE TRIGGER fail_images BEFORE UPDATE OF images ON stories
              WHEN NEW.images IS NOT NULL BEGIN SELECT RAISE(FAIL, 'disk full'); END`);
  other.close();

  const { id } = await generateStory(app, true);
  const images = await waitForIllustrations(app, id);
  assert.deepEqual(images, [null, null, null]);
  assert.equal(fs.existsSync(path.join(imagesPath, id)), false);
  assert.equal((await summaryOf(app, id)).coverUrl, null);
  const story = await request(app).get(`/api/stories/${id}`);
  assert.equal(story.status, 200);
});
