import path from 'path';
import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';

import logger from './logger';
import swaggerSpec from './swagger';
import healthRoutes from './routes/health';
import figureRoutes from './routes/figures';
import storyRoutes from './routes/stories';

const app = express();

app.use(cors());
app.use(express.json());
app.use(
  pinoHttp({
    logger,
    // health checks would otherwise spam the log on every Docker/Portainer healthcheck poll
    autoLogging: { ignore: (req) => req.url === '/api/health' },
    // pino-http's default req/res serializers dump full headers on every line - too noisy
    // for routine monitoring, so cut each down to what's actually useful to see
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api', healthRoutes);
app.use('/api', figureRoutes);
app.use('/api', storyRoutes);

// serve the frontend as static files so the whole app is one process/port
app.use(express.static(path.join(__dirname, '..', '..', 'ui')));

export default app;
