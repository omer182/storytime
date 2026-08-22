import app from './app';
import config from './config';

app.listen(config.port, () => {
  console.log(`storytime server listening on http://localhost:${config.port}`);
  console.log(`  UI:      http://localhost:${config.port}/`);
  console.log(`  Swagger: http://localhost:${config.port}/docs`);
});
