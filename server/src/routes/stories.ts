import { Router, Request, Response } from 'express';
import * as storyService from '../services/storyService';
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
 *     summary: Register a scan against this story (called by the ESP on each NFC read)
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
 *               uid: { type: string, example: "04A1B2C3" }
 *     responses:
 *       200:
 *         description: >
 *           Always 200 even for an unknown tag, so the ESP has a clean response
 *           to drive the LED off `led` (green_pulse / blue_pulse / red_wiggle).
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
 *     summary: Remove a scanned figure from a story (correction, e.g. mis-scan)
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
 * /api/stories/{id}/generate:
 *   post:
 *     summary: Generate the story text (and, if enabled, illustrations) from the scanned figures
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
