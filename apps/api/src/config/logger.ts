type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveThreshold(): number {
  const configured = process.env.LOG_LEVEL as Level | undefined;
  const level: Level =
    configured && configured in LEVEL_ORDER ? configured : (process.env.NODE_ENV === 'test' ? 'error' : 'info');
  return LEVEL_ORDER[level];
}

const threshold = resolveThreshold();

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < threshold) return;

  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ?? {}),
  };

  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};
