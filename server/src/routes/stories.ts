import { Router, Request, Response } from 'express';
import * as storyService from '../services/storyService';
import * as illustrationStore from '../services/illustrationStore';
import logger from '../logger';

const router = Router();

/**
 * @openapi
 * /api/stories:
 *   post:
 *     summary: Start a new story (empty, status "collecting")
 *     tags: [Stories]
 *     responses:
 *       201:
 *         description: Created
 *   get:
 *     summary: List generated stories (history) - stories still being collected are not included
 *     tags: [Stories]
 *     responses:
 *       200:
 *         description: Story list
 */
router.post('/stories', (req: Request, res: Response) => {
  const story = storyService.createStory();
  res.status(201).json(story);
});

router.get('/stories', (req: Request, res: Response) => {
  res.json(storyService.listStories());
});

/**
 * @openapi
 * /api/stories/{id}:
 *   get:
 *     summary: Get a story, its figures, and its text (if generated)
 *     tags: [Stories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Story }
 *       404: { description: Not found }
 */
router.get('/stories/:id', (req: Request, res: Response) => {
  const story = storyService.getStory(req.params.id);
  if (!story) return res.status(404).json({ error: 'story not found' });
  res.json(story);
});

/**
 * @openapi
 * /api/stories/{id}/figures:
 *   post:
 *     summary: Add a figure from the deck to this story's cast
 *     tags: [Stories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [uid]
 *             properties:
 *               uid: { type: string, example: "PLACEHOLDER-CHAR-01" }
 *     responses:
 *       200:
 *         description: >
 *           Always 200 for an existing story. `recognized: false` means the uid is not in
 *           the deck; `duplicate: true` means the figure is already in this story (nothing
 *           added). Otherwise the figure is added and `figures` is the story's updated cast.
 *       400: { description: uid missing }
 *       404: { description: Story not found }
 */
router.post('/stories/:id/figures', (req: Request, res: Response) => {
  const { uid } = req.body || {};
  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'uid is required' });
  }

  const result = storyService.addFigure(req.params.id, uid);
  if (result.notFound) return res.status(404).json({ error: 'story not found' });
  res.json(result);
});

/**
 * @openapi
 * /api/stories/{id}/figures/{entryId}:
 *   delete:
 *     summary: Remove a figure from a story's cast
 *     tags: [Stories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204: { description: Removed }
 *       404: { description: Not found }
 */
router.delete('/stories/:id/figures/:entryId', (req: Request, res: Response) => {
  const removed = storyService.removeFigure(req.params.id, req.params.entryId);
  if (!removed) return res.status(404).json({ error: 'figure entry not found' });
  res.status(204).send();
});

/**
 * @openapi
 * /api/stories/{id}/favorite:
 *   patch:
 *     summary: Mark or unmark a story as a favorite
 *     tags: [Stories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [favorite]
 *             properties:
 *               favorite: { type: boolean }
 *     responses:
 *       200: { description: Updated story }
 *       400: { description: Invalid favorite value }
 *       404: { description: Story not found }
 */
router.patch('/stories/:id/favorite', (req: Request, res: Response) => {
  const { favorite } = req.body || {};
  if (typeof favorite !== 'boolean') {
    return res.status(400).json({ error: 'favorite must be a boolean' });
  }
  const story = storyService.setFavorite(req.params.id, favorite);
  if (!story) return res.status(404).json({ error: 'story not found' });
  res.json(story);
});

const VALID_LENGTHS = ['short', 'medium', 'long'];

/**
 * @openapi
 * /api/stories/{id}/images:
 *   get:
 *     summary: Collect the illustrations for a story generated in this server run
 *     description: >
 *       Generate returns as soon as the story text is ready and leaves the illustrations
 *       rendering in the background; poll this until status is "done". Each entry is the URL of
 *       a saved scene (see /api/stories/{id}/images/{file}), or null while it is still rendering
 *       or when it could not be drawn. The job itself is memory-only, so an unknown or restarted
 *       story reports "none" - GET /api/stories/{id} then lists whatever was saved.
 *     tags: [Stories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Current state of the illustrations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, enum: [pending, done, none] }
 *                 images:
 *                   type: array
 *                   items: { type: string, nullable: true }
 */
router.get('/stories/:id/images', (req: Request, res: Response) => {
  const job = storyService.getImageJob(req.params.id);
  if (!job) return res.json({ status: 'none', images: [] });
  res.json({ status: job.status, images: job.images });
});

/**
 * @openapi
 * /api/stories/{id}/images/{file}:
 *   get:
 *     summary: One persisted illustration of a story (scene 0-2, or its history cover)
 *     tags: [Stories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: file
 *         required: true
 *         schema: { type: string, enum: [0.webp, 1.webp, 2.webp, cover.webp] }
 *     responses:
 *       200:
 *         description: The image (immutable - safe to cache forever)
 *         content:
 *           image/webp: {}
 *       404: { description: No such illustration }
 */
router.get('/stories/:id/images/:file', (req: Request, res: Response) => {
  const file = illustrationStore.resolveImageFile(req.params.id, req.params.file);
  if (!file) return res.status(404).json({ error: 'image not found' });
  res.sendFile(
    file,
    { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' } },
    (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'image not found' });
    }
  );
});

/**
 * @openapi
 * /api/stories/{id}/generate:
 *   post:
 *     summary: Generate the story text (and, if enabled, illustrations) from the story's cast
 *     description: >
 *       Requires at least one figure each of category character, location, and mood.
 *       Returns 422 listing which required categories are still missing.
 *     tags: [Stories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               length: { type: string, enum: [short, medium, long], default: medium }
 *               generateImages: { type: boolean, default: true, description: "per-story opt-out of illustrations (still requires GENERATE_IMAGES/OPENAI_API_KEY to be enabled server-side)" }
 *     responses:
 *       200: { description: Story generated }
 *       400: { description: Invalid length or generateImages value }
 *       404: { description: Story not found }
 *       422: { description: Missing required categories }
 */
router.post('/stories/:id/generate', async (req: Request, res: Response) => {
  const { length, generateImages } = req.body || {};

  if (length !== undefined && !VALID_LENGTHS.includes(length)) {
    return res.status(400).json({ error: `length must be one of: ${VALID_LENGTHS.join(', ')}` });
  }
  if (generateImages !== undefined && typeof generateImages !== 'boolean') {
    return res.status(400).json({ error: 'generateImages must be a boolean' });
  }

  try {
    const result = await storyService.generateStory(req.params.id, { length, generateImages });
    if ('notFound' in result && result.notFound) {
      return res.status(404).json({ error: 'story not found' });
    }
    if ('validationError' in result && result.validationError) {
      return res.status(422).json({
        error: 'missing required figure categories',
        missing: result.missing,
      });
    }
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, storyId: req.params.id }, 'story generation request failed');
    res.status(502).json({ error: 'story generation failed', detail: message });
  }
});

export default router;
