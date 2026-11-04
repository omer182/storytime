import assert from 'node:assert/strict';
import request from 'supertest';
import type { Express } from 'express';

export async function generateStory(app: Express, generateImages: boolean): Promise<{ id: string; body: Record<string, unknown> }> {
  const figures = (await request(app).get('/api/figures')).body as { uid: string; category: string }[];
  const created = await request(app).post('/api/stories');
  for (const category of ['character', 'location', 'mood']) {
    const uid = figures.find((f) => f.category === category)!.uid;
    await request(app).post(`/api/stories/${created.body.id}/figures`).send({ uid });
  }
  const generated = await request(app).post(`/api/stories/${created.body.id}/generate`).send({ generateImages });
  assert.equal(generated.status, 200);
  return { id: created.body.id, body: generated.body };
}

// polls the in-progress endpoint every 50ms (5s cap) until the illustrations are done
export async function waitForIllustrations(app: Express, id: string): Promise<(string | null)[]> {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const res = await request(app).get(`/api/stories/${id}/images`);
    if (res.body.status === 'done') return res.body.images;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('illustrations never finished');
}

export async function summaryOf(app: Express, id: string): Promise<{ coverUrl: string | null }> {
  const list = await request(app).get('/api/stories');
  return list.body.find((s: { id: string }) => s.id === id);
}
