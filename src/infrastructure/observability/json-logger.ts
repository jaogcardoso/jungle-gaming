import type { LoggerService } from '@nestjs/common';

/** Logs estruturados em JSON (README §12). */
export class JsonLogger implements LoggerService {
  private write(level: string, message: unknown, context?: string): void {
    const base: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      context,
    };
    if (message && typeof message === 'object') {
      Object.assign(base, message);
    } else {
      base['msg'] = message;
    }
    const line = JSON.stringify(base);
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }
  error(message: unknown, stackOrContext?: string, context?: string): void {
    this.write('error', message, context ?? stackOrContext);
  }
  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }
  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }
}
