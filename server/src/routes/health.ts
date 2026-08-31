import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

// __dirname is server/src/routes in dev, server/dist/routes in prod - both are two levels
// below server/, where package.json lives
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: Health check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Server is up
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 version:
 *                   type: string
 *                   example: 1.3.0
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', version: pkg.version as string });
});

export default router;
