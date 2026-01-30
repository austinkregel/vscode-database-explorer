import * as vscode from 'vscode';
import { LastViewedTable } from '../types';

const STORAGE_KEY = 'database-explorer.lastViewedTable';

/**
 * Table Status Bar
 * 
 * Displays the last viewed table in the VS Code status bar.
 * Clicking the status bar item reopens the table with the last used query.
 */
export class TableStatusBar {
  private statusBarItem: vscode.StatusBarItem;
  private lastViewed: LastViewedTable | null = null;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    // Create status bar item on the left side (priority 100 = more left)
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );

    // Light blue color for visibility
    this.statusBarItem.color = '#7CB9E8';

    // Command to reopen the last viewed table
    this.statusBarItem.command = 'database-explorer.reopenLastTable';

    // Load persisted state
    this.loadState();
    this.update();

    // Register the status bar item for disposal
    context.subscriptions.push(this.statusBarItem);
  }

  /**
   * Set the last viewed table
   */
  setLastViewed(table: LastViewedTable): void {
    this.lastViewed = table;
    this.saveState();
    this.update();
  }

  /**
   * Get the last viewed table
   */
  getLastViewed(): LastViewedTable | null {
    return this.lastViewed;
  }

  /**
   * Clear the last viewed table
   */
  clear(): void {
    this.lastViewed = null;
    this.saveState();
    this.update();
  }

  /**
   * Update the status bar display
   */
  private update(): void {
    if (this.lastViewed) {
      const qualifiedName = this.lastViewed.schema
        ? `${this.lastViewed.schema}.${this.lastViewed.table}`
        : this.lastViewed.table;

      this.statusBarItem.text = `$(table) ${qualifiedName}`;
      this.statusBarItem.tooltip = this.buildTooltip();
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  /**
   * Build the tooltip text
   */
  private buildTooltip(): string {
    if (!this.lastViewed) {
      return '';
    }

    const qualifiedName = this.lastViewed.schema
      ? `${this.lastViewed.schema}.${this.lastViewed.table}`
      : this.lastViewed.table;

    const lines = [
      `Last viewed: ${this.lastViewed.connectionName} > ${qualifiedName}`,
      '',
      'Click to reopen',
      '',
      `Query: ${this.truncateQuery(this.lastViewed.query)}`
    ];

    return lines.join('\n');
  }

  /**
   * Truncate long queries for tooltip display
   */
  private truncateQuery(query: string): string {
    const maxLength = 100;
    const singleLine = query.replace(/\s+/g, ' ').trim();
    if (singleLine.length <= maxLength) {
      return singleLine;
    }
    return singleLine.substring(0, maxLength) + '...';
  }

  /**
   * Save state to workspace storage
   */
  private saveState(): void {
    this.context.workspaceState.update(STORAGE_KEY, this.lastViewed);
  }

  /**
   * Load state from workspace storage
   */
  private loadState(): void {
    this.lastViewed = this.context.workspaceState.get<LastViewedTable>(STORAGE_KEY) || null;
  }

  /**
   * Dispose of the status bar item
   */
  dispose(): void {
    this.statusBarItem.dispose();
  }
}

/**
 * Create and register the table status bar
 */
export function createTableStatusBar(context: vscode.ExtensionContext): TableStatusBar {
  return new TableStatusBar(context);
}
