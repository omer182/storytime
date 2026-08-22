import pino from 'pino';
import config from './config';

const logger = pino({
  level: config.logLevel,
  // skip spinning up the pino-pretty worker thread entirely when logging is off (tests) -
  // it's pure startup cost with nothing to format
  transport:
    config.logPretty && config.logLevel !== 'silent'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        }
      : undefined,
});

export default logger;
