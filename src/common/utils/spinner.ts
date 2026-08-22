// Minimal terminal spinner replacing the `ora` package.
// Animates on a TTY, and degrades to plain lines (one on start, one on completion)
// when the output is not interactive (CI, redirected output, VS Code UI).
import c from 'chalk';

export interface SpinnerOptions {
  text?: string;
  /** Animation frames. Defaults to the moon phases (previous ora "moon" preset). */
  frames?: string[];
  /** Delay between frames in milliseconds. */
  interval?: number;
  /** Output stream. Defaults to process.stderr, like ora. */
  stream?: NodeJS.WriteStream;
}

const MOON_FRAMES = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
const SYMBOL_SUCCESS = c.green('✔');
const SYMBOL_FAIL = c.red('✖');
const SYMBOL_WARN = c.yellow('⚠');
const SYMBOL_INFO = c.blue('ℹ');

export class Spinner {
  private currentText: string;
  private readonly frames: string[];
  private readonly interval: number;
  private readonly stream: NodeJS.WriteStream;
  private timer: NodeJS.Timeout | null = null;
  private frameIndex = 0;
  private lastLineLength = 0;

  constructor(options: SpinnerOptions = {}) {
    this.currentText = options.text || '';
    this.frames = options.frames && options.frames.length > 0 ? options.frames : MOON_FRAMES;
    this.interval = options.interval || 80;
    this.stream = options.stream || process.stderr;
  }

  get text(): string {
    return this.currentText;
  }

  set text(value: string) {
    this.currentText = value;
    if (this.isSpinning) {
      this.render();
    }
  }

  get isSpinning(): boolean {
    return this.timer !== null;
  }

  get isEnabled(): boolean {
    return Boolean(this.stream.isTTY) && process.env.TERM !== 'dumb' && !process.env.CI;
  }

  start(text?: string): this {
    if (text) {
      this.currentText = text;
    }
    if (this.isSpinning) {
      return this;
    }
    if (!this.isEnabled) {
      if (this.currentText) {
        this.stream.write(`- ${this.currentText}\n`);
      }
      return this;
    }
    this.render();
    this.timer = setInterval(() => this.render(), this.interval);
    // Never keep the process alive only for the animation
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    return this;
  }

  stop(): this {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.clearLine();
    }
    return this;
  }

  succeed(text?: string): this {
    return this.stopAndPersist(SYMBOL_SUCCESS, text);
  }

  fail(text?: string): this {
    return this.stopAndPersist(SYMBOL_FAIL, text);
  }

  warn(text?: string): this {
    return this.stopAndPersist(SYMBOL_WARN, text);
  }

  info(text?: string): this {
    return this.stopAndPersist(SYMBOL_INFO, text);
  }

  private stopAndPersist(symbol: string, text?: string): this {
    this.stop();
    const finalText = text ?? this.currentText;
    this.stream.write(`${symbol} ${finalText}\n`);
    return this;
  }

  private render(): void {
    const frame = this.frames[this.frameIndex];
    this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    const line = `${frame} ${this.currentText}`;
    this.clearLine();
    this.stream.write(line);
    this.lastLineLength = line.length;
  }

  private clearLine(): void {
    if (this.lastLineLength > 0) {
      // Carriage return then erase to end of line
      this.stream.write('\r\x1b[K');
      this.lastLineLength = 0;
    }
  }
}

/** Creates a spinner. Call `.start()` on the result, like `ora(options).start()`. */
export function createSpinner(options: SpinnerOptions | string = {}): Spinner {
  return new Spinner(typeof options === 'string' ? { text: options } : options);
}
