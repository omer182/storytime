import app from './app';
import config from './config';
import logger from './logger';

app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      llmProvider: config.llmProvider,
      llmModel: config.llmModel,
      generateImages: config.generateImages && !!config.openaiApiKey,
      imageModel: config.imageModel,
    },
    `storytime server listening on http://localhost:${config.port}`
  );
});
