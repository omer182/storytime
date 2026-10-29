import fs from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import sharp from 'sharp';
import config from '../config';
import db from '../data/db';
import { StoryImagesRecord } from '../types';

// Illustrations live on disk as plain files - <imagesPath>/<storyId>/<0|1|2|cover>.webp - not in
// the db, so neither the sqlite file nor the JSON responses carry image bytes. The db only
// records which files exist (stories.images), and a file is always in place before its row
// says so.

export type ImageFile = '0.webp' | '1.webp' | '2.webp' | 'cover.webp';

const IMAGE_FILES: readonly string[] = ['0.webp', '1.webp', '2.webp', 'cover.webp'];
const STORY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCENE_COUNT = 3;

// history cards show the cover at ~260-380 css px, so 384 wide stays sharp on most screens
// for ~20KB instead of the ~120KB full scene
const COVER_WIDTH = 384;
const COVER_QUALITY = 75;

const setImagesStmt = db.prepare('UPDATE stories SET images = ? WHERE id = ?');

function storyDir(storyId: string): string {
  if (!STORY_ID_RE.test(storyId)) throw new Error(`invalid story id: ${storyId}`);
  return path.join(config.imagesPath, storyId);
}

async function writeFileAtomic(file: string, data: Buffer): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`; // unique: two renders of one story may overlap
  await fs.promises.writeFile(tmp, data);
  await fs.promises.rename(tmp, file);
}

function sceneFile(index: number): ImageFile {
  if (!Number.isInteger(index) || index < 0 || index >= SCENE_COUNT) {
    throw new Error(`invalid scene index: ${index}`);
  }
  return `${index}.webp` as ImageFile;
}

// dataUrl is what the image provider hands back: data:image/webp;base64,...
export async function saveScene(storyId: string, index: number, dataUrl: string): Promise<void> {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  await writeFileAtomic(path.join(storyDir(storyId), sceneFile(index)), Buffer.from(base64, 'base64'));
}

export async function saveCover(storyId: string, sourceIndex: number): Promise<void> {
  const dir = storyDir(storyId);
  const cover = await sharp(path.join(dir, sceneFile(sourceIndex)))
    .resize({ width: COVER_WIDTH })
    .webp({ quality: COVER_QUALITY })
    .toBuffer();
  await writeFileAtomic(path.join(dir, 'cover.webp'), cover);
}

// absolute path of a servable image, or null for anything that isn't exactly one of ours -
// both parts come straight from the URL, so this is the path-traversal guard
export function resolveImageFile(storyId: string, file: string): string | null {
  if (!STORY_ID_RE.test(storyId) || !IMAGE_FILES.includes(file)) return null;
  return path.join(config.imagesPath, storyId, file);
}

export function imageUrl(storyId: string, file: ImageFile): string {
  return `/api/stories/${storyId}/images/${file}`;
}

export function sceneUrl(storyId: string, index: number): string {
  return imageUrl(storyId, sceneFile(index));
}

export function sceneUrls(storyId: string, record: StoryImagesRecord): (string | null)[] {
  return record.scenes.map((saved, i) => (saved ? sceneUrl(storyId, i) : null));
}

export function setStoryImages(storyId: string, record: StoryImagesRecord): void {
  setImagesStmt.run(JSON.stringify(record), storyId);
}

// for files no row will ever point at
export async function removeStoryImages(storyId: string): Promise<void> {
  await fs.promises.rm(storyDir(storyId), { recursive: true, force: true });
}

export function parseStoryImages(raw: string | null): StoryImagesRecord | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoryImagesRecord;
  } catch {
    return null;
  }
}
