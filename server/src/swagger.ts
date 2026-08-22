import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';

// swagger-jsdoc's glob needs forward slashes even on Windows, and matches both
// .ts (dev, via tsx running src/ in place) and .js (prod, compiled to dist/)
const routesGlob = path.join(__dirname, 'routes', '*.{ts,js}').split(path.sep).join('/');

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Storytime API',
      version: '1.0.0',
      description: 'NFC figure scans -> Hebrew bedtime story, via Claude',
    },
  },
  apis: [routesGlob],
});

export default spec;
