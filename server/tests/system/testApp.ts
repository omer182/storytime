import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// each test file runs in its own process (node:test default), but give every
// file its own db file anyway so nothing depends on that isolation staying true
const dbPath = path.join(os.tmpdir(), `storytime-test-${crypto.randomUUID()}.db`);
process.env.DB_PATH = dbPath;
process.env.LLM_PROVIDER = 'mock';

// must be require(), not a static `import` - TS/ESM imports get hoisted above
// plain statements once compiled, which would open the sqlite db (via app's
// import chain) before DB_PATH above was ever set.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require('../../src/app').default;

export function cleanup(): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      // file may not exist depending on sqlite journal mode - fine
    }
  }
}

export { app, dbPath };
