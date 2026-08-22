import path from 'path';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';

import swaggerSpec from './swagger';
import healthRoutes from './routes/health';
import figureRoutes from './routes/figures';
import storyRoutes from './routes/stories';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api', healthRoutes);
app.use('/api', figureRoutes);
app.use('/api', storyRoutes);

// serve the frontend as static files so the whole app is one process/port
app.use(express.static(path.join(__dirname, '..', '..', 'ui')));

export default app;
