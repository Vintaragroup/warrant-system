/* Simple structured logger */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const envLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

export const logger = {
  log(level: LogLevel, msg: string, meta: Record<string, unknown> = {}) {
    if (levelOrder[level] < levelOrder[envLevel]) return;
    const line = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...meta,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(line));
  },
  debug: (msg: string, meta: Record<string, unknown> = {}) =>
    logger.log('debug', msg, meta),
  info: (msg: string, meta: Record<string, unknown> = {}) =>
    logger.log('info', msg, meta),
  warn: (msg: string, meta: Record<string, unknown> = {}) =>
    logger.log('warn', msg, meta),
  error: (msg: string, meta: Record<string, unknown> = {}) =>
    logger.log('error', msg, meta),
};
