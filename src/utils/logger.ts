import * as vscode from 'vscode';

/**
 * Logger utility for the Database Explorer extension.
 * Outputs to a dedicated VS Code Output Channel.
 */
class Logger {
  private outputChannel: vscode.OutputChannel | null = null;
  private debugMode = false;

  /**
   * Initialize the logger with an output channel
   */
  init(context: vscode.ExtensionContext): void {
    this.outputChannel = vscode.window.createOutputChannel('Database Explorer');
    context.subscriptions.push(this.outputChannel);
    
    // Check if debug mode is enabled in settings
    const config = vscode.workspace.getConfiguration('databaseExplorer');
    this.debugMode = config.get<boolean>('debugMode', false);
    
    this.info('Database Explorer logger initialized');
  }

  /**
   * Log an info message
   */
  info(message: string, ...args: unknown[]): void {
    this.log('INFO', message, ...args);
  }

  /**
   * Log a warning message
   */
  warn(message: string, ...args: unknown[]): void {
    this.log('WARN', message, ...args);
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error | unknown): void {
    if (error instanceof Error) {
      this.log('ERROR', `${message}: ${error.message}`);
      if (error.stack && this.debugMode) {
        this.log('ERROR', error.stack);
      }
    } else if (error !== undefined) {
      this.log('ERROR', `${message}: ${String(error)}`);
    } else {
      this.log('ERROR', message);
    }
  }

  /**
   * Log a debug message (only shown when debugMode is enabled)
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.debugMode) {
      this.log('DEBUG', message, ...args);
    }
  }

  /**
   * Log a message with timestamp and level
   */
  private log(level: string, message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    let fullMessage = `[${timestamp}] [${level}] ${message}`;
    
    if (args.length > 0) {
      const argsStr = args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');
      fullMessage += ` ${argsStr}`;
    }

    // Output to the channel
    if (this.outputChannel) {
      this.outputChannel.appendLine(fullMessage);
    }
    
    // Also log to console for debugging
    console.log(fullMessage);
  }

  /**
   * Show the output channel
   */
  show(): void {
    this.outputChannel?.show();
  }

  /**
   * Clear the output channel
   */
  clear(): void {
    this.outputChannel?.clear();
  }
}

// Export singleton instance
export const logger = new Logger();
