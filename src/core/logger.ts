/** Minimal leveled logger with a redaction hook so tokens never reach output. */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  level?: LogLevel;
  /** Applied to every message before printing; defaults to identity. */
  redact?: (text: string) => string;
  quiet?: boolean;
}

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export class Logger {
  private readonly level: LogLevel;
  private readonly redactFn: (text: string) => string;
  private readonly quiet: boolean;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.redactFn = options.redact ?? ((text) => text);
    this.quiet = options.quiet ?? false;
  }

  debug(message: string): void {
    this.write("debug", message);
  }

  info(message: string): void {
    this.write("info", message);
  }

  warn(message: string): void {
    this.write("warn", message);
  }

  error(message: string): void {
    this.write("error", message);
  }

  private write(level: LogLevel, message: string): void {
    if (this.quiet || ORDER[level] < ORDER[this.level]) {
      return;
    }

    const safe = this.redactFn(message);
    if (level === "error") {
      process.stderr.write(`[figma-to-uprefab] ${safe}\n`);
    } else {
      process.stdout.write(`[figma-to-uprefab] ${safe}\n`);
    }
  }
}
