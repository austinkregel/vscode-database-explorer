import * as vscode from 'vscode';
import { DbDriver, ConnectionConfig } from '../types';
import { logger } from '../utils/logger';

export class QueryPanel {
  public static currentPanel: QueryPanel | undefined;
  private static readonly viewType = 'databaseExplorer.queryPanel';

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _driver: DbDriver;
  private _connection: ConnectionConfig;

  public static createOrShow(
    extensionUri: vscode.Uri, 
    connection: ConnectionConfig, 
    driver: DbDriver, 
    initialQuery: string = '',
    autoRun: boolean = false
  ): void {
    logger.debug('QueryPanel.createOrShow called', {
      connectionName: connection.name,
      connectionType: connection.type,
      hasInitialQuery: !!initialQuery,
      autoRun
    });

    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    if (QueryPanel.currentPanel) {
      logger.debug('Reusing existing QueryPanel');
      QueryPanel.currentPanel._panel.reveal(column);
      QueryPanel.currentPanel._driver = driver;
      QueryPanel.currentPanel._connection = connection;
      QueryPanel.currentPanel._updateWebview(initialQuery, autoRun);
      return;
    }

    // Create a new panel
    logger.debug('Creating new QueryPanel');
    const panel = vscode.window.createWebviewPanel(
      QueryPanel.viewType,
      `Query: ${connection.name}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    QueryPanel.currentPanel = new QueryPanel(panel, extensionUri, connection, driver, initialQuery, autoRun);
    logger.info(`QueryPanel created for connection: ${connection.name}`);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    _extensionUri: vscode.Uri,  // Reserved for future resource loading
    connection: ConnectionConfig,
    driver: DbDriver,
    initialQuery: string,
    autoRun: boolean
  ) {
    this._panel = panel;
    this._connection = connection;
    this._driver = driver;

    this._updateWebview(initialQuery, autoRun);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        // Handle log messages from webview
        if (message.command === 'log') {
          logger.debug(`[Webview] ${message.message}`);
          return;
        }
        
        logger.debug('QueryPanel received message', { command: message.command });
        try {
          switch (message.command) {
            case 'executeQuery':
              await this._executeQuery(message.sql);
              break;
            case 'getDDL':
              await this._getDDL(message.table, message.schema);
              break;
            case 'insertRow':
              await this._insertRow(message.table, message.schema, message.data);
              break;
            case 'updateRow':
              await this._updateRow(message.table, message.schema, message.primaryKeys, message.data);
              break;
            case 'deleteRow':
              await this._deleteRow(message.table, message.schema, message.primaryKeys);
              break;
            default:
              logger.warn(`Unknown message command: ${message.command}`);
          }
        } catch (err) {
          logger.error(`Error handling message ${message.command}`, err);
        }
      },
      null,
      this._disposables
    );

    // Handle panel disposal
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  private async _executeQuery(sql: string): Promise<void> {
    logger.debug('Executing query', { sqlPreview: sql.substring(0, 100) });
    const startTime = Date.now();
    try {
      const result = await this._driver.executeQuery(sql);
      const duration = Date.now() - startTime;
      logger.info(`Query executed in ${duration}ms, returned ${result.rowCount} rows`);
      this._panel.webview.postMessage({
        type: 'queryResult',
        result,
        sql
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Query failed after ${duration}ms`, error);
      this._panel.webview.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async _getDDL(table: string, schema?: string): Promise<void> {
    try {
      const ddl = await this._driver.getDDL(table, schema);
      this._panel.webview.postMessage({
        type: 'ddlResult',
        ddl
      });
    } catch (error) {
      this._panel.webview.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async _insertRow(table: string, schema: string | undefined, data: Record<string, unknown>): Promise<void> {
    try {
      const result = await this._driver.insertRow(table, data, schema);
      this._panel.webview.postMessage({
        type: 'rowInserted',
        result
      });
    } catch (error) {
      this._panel.webview.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async _updateRow(
    table: string, 
    schema: string | undefined, 
    primaryKeys: Record<string, unknown>, 
    data: Record<string, unknown>
  ): Promise<void> {
    try {
      const result = await this._driver.updateRow(table, primaryKeys, data, schema);
      this._panel.webview.postMessage({
        type: 'rowUpdated',
        result
      });
    } catch (error) {
      this._panel.webview.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async _deleteRow(table: string, schema: string | undefined, primaryKeys: Record<string, unknown>): Promise<void> {
    try {
      const result = await this._driver.deleteRow(table, primaryKeys, schema);
      this._panel.webview.postMessage({
        type: 'rowDeleted',
        result
      });
    } catch (error) {
      this._panel.webview.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private _updateWebview(initialQuery: string, autoRun: boolean): void {
    logger.debug('Updating webview', { 
      hasInitialQuery: !!initialQuery, 
      queryLength: initialQuery.length,
      autoRun 
    });
    this._panel.title = `Query: ${this._connection.name}`;
    this._panel.webview.html = this._getHtmlForWebview(initialQuery, autoRun);
    logger.debug('Webview HTML set successfully');
  }

  private _getHtmlForWebview(initialQuery: string, autoRun: boolean): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Query Panel</title>
  <style>
    :root {
      --bg-primary: var(--vscode-editor-background);
      --bg-secondary: var(--vscode-sideBar-background);
      --text-primary: var(--vscode-editor-foreground);
      --text-secondary: var(--vscode-descriptionForeground);
      --border-color: var(--vscode-panel-border);
      --accent: var(--vscode-button-background);
      --accent-hover: var(--vscode-button-hoverBackground);
      --input-bg: var(--vscode-input-background);
      --input-border: var(--vscode-input-border);
      --error-color: var(--vscode-errorForeground);
      --success-color: var(--vscode-terminal-ansiGreen);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--text-primary);
      background: var(--bg-primary);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .query-container {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-secondary);
    }

    .toolbar-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .toolbar-group.spacer {
      flex: 1;
    }

    .toolbar-button {
      padding: 4px 10px;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background: transparent;
      color: var(--text-primary);
      font-size: 11px;
      cursor: pointer;
    }

    .toolbar-button.primary {
      background: var(--accent);
      color: var(--vscode-button-foreground);
      border-color: transparent;
    }

    .toolbar-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .toolbar-input,
    .toolbar-select {
      background: var(--input-bg);
      color: var(--text-primary);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 11px;
    }

    .toolbar-label {
      font-size: 11px;
      color: var(--text-secondary);
    }

    .editor-section {
      flex: 0 0 200px;
      display: flex;
      flex-direction: column;
      border-bottom: 1px solid var(--border-color);
      padding: 12px;
    }

    .editor-section.collapsed {
      display: none;
    }

    .editor-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .editor-title {
      font-weight: 600;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-secondary);
    }

    .btn {
      padding: 6px 14px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.15s ease;
    }

    .btn-primary {
      background: var(--accent);
      color: var(--vscode-button-foreground);
    }

    .btn-primary:hover {
      background: var(--accent-hover);
    }

    .btn-secondary {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-primary);
    }

    .btn-secondary:hover {
      background: var(--bg-secondary);
    }

    .btn-danger {
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--error-color);
    }

    .sql-editor {
      flex: 1;
      width: 100%;
      resize: none;
      background: var(--input-bg);
      color: var(--text-primary);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 10px;
      font-family: var(--vscode-editor-font-family), 'Fira Code', 'Consolas', monospace;
      font-size: 13px;
      line-height: 1.5;
    }

    .sql-editor:focus {
      outline: 1px solid var(--accent);
      border-color: var(--accent);
    }

    .results-section {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding: 12px;
    }

    .results-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .results-info {
      font-size: 12px;
      color: var(--text-secondary);
    }

    .results-actions {
      display: flex;
      gap: 8px;
    }

    .table-container {
      flex: 1;
      overflow: auto;
      border: 1px solid var(--border-color);
      border-radius: 4px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    thead {
      position: sticky;
      top: 0;
      z-index: 10;
    }

    th {
      background: color-mix(in srgb, var(--bg-secondary) 85%, transparent);
      padding: 6px 10px;
      text-align: left;
      font-weight: 600;
      border-bottom: 2px solid var(--border-color);
      white-space: nowrap;
      cursor: pointer;
    }

    td {
      padding: 5px 10px;
      border-bottom: 1px solid var(--border-color);
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    tr:hover td {
      background: var(--bg-secondary);
    }

    tr.selected td {
      background: color-mix(in srgb, var(--accent) 20%, transparent);
    }

    .cell-editable {
      cursor: pointer;
    }

    .cell-editable:hover {
      background: var(--input-bg);
    }

    .cell-input {
      width: 100%;
      background: var(--input-bg);
      color: var(--text-primary);
      border: 1px solid var(--accent);
      padding: 4px 8px;
      font-family: inherit;
      font-size: inherit;
    }

    .message {
      padding: 12px 16px;
      border-radius: 4px;
      margin-bottom: 12px;
      font-size: 13px;
    }

    .message-error {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--error-color);
      color: var(--error-color);
    }

    .message-success {
      background: color-mix(in srgb, var(--success-color) 15%, transparent);
      border: 1px solid var(--success-color);
      color: var(--success-color);
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-secondary);
    }

    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    .row-actions {
      display: flex;
      gap: 4px;
    }

    .row-action-btn {
      padding: 2px 6px;
      font-size: 11px;
      border-radius: 3px;
    }

    .kbd {
      display: inline-block;
      padding: 2px 6px;
      font-size: 11px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 3px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="query-container">
    <div class="toolbar">
      <div class="toolbar-group">
        <button class="toolbar-button" id="toggleEditorBtn">Hide SQL</button>
        <button class="toolbar-button primary" id="executeBtn">Run</button>
        <button class="toolbar-button" id="ddlBtn">DDL</button>
      </div>
      <div class="toolbar-group spacer"></div>
      <div class="toolbar-group">
        <span class="toolbar-label">Order By</span>
        <select id="orderBySelect" class="toolbar-select" disabled>
          <option value="">None</option>
        </select>
        <button class="toolbar-button" id="orderDirBtn" disabled>ASC</button>
        <button class="toolbar-button" id="exportBtn" disabled>Export CSV</button>
        <input id="rowFilterInput" class="toolbar-input" placeholder="Search" />
      </div>
    </div>
    <div class="editor-section">
      <div class="editor-header">
        <span class="editor-title">SQL Query</span>
        <div>
          <span style="font-size: 11px; color: var(--text-secondary); margin-right: 12px;">
            <span class="kbd">Ctrl</span> + <span class="kbd">Enter</span> to execute
          </span>
        </div>
      </div>
      <textarea class="sql-editor" id="sqlEditor" placeholder="Enter your SQL query here...">${escapeHtml(initialQuery)}</textarea>
    </div>

    <div class="results-section">
      <noscript>
        <div style="padding: 20px; background: #ff000033; color: red; border: 1px solid red; margin: 10px;">
          JavaScript is disabled or blocked. Check Content Security Policy.
        </div>
      </noscript>
      <div id="messageContainer"></div>
      <div class="results-header">
        <span class="results-info" id="resultsInfo">No results</span>
        <div class="results-actions" id="resultsActions" style="display: none;">
          <button class="btn btn-secondary" id="addRowBtn">Add Row</button>
        </div>
      </div>
      <div class="table-container" id="tableContainer">
        <div class="empty-state">
          <div class="empty-state-icon">📊</div>
          <p>Execute a query to see results</p>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    // Immediately try to establish communication
    let vscode;
    try {
      vscode = acquireVsCodeApi();
      vscode.postMessage({ command: 'log', message: 'Webview script starting...' });
    } catch (e) {
      console.error('Failed to acquire VS Code API:', e);
    }
    
    const autoRun = ${autoRun ? 'true' : 'false'};
    
    // Global error handlers
    window.onerror = function(message, source, lineno, colno, error) {
      const errorMsg = 'JS Error: ' + message + ' at line ' + lineno;
      console.error(errorMsg, error);
      if (vscode) {
        vscode.postMessage({ command: 'log', message: errorMsg });
      }
      const existing = document.getElementById('messageContainer');
      if (existing) {
        existing.innerHTML = '<div class="message message-error">' + errorMsg + '</div>';
      }
      return false;
    };
    
    window.onunhandledrejection = function(event) {
      const errorMsg = 'Unhandled Promise rejection: ' + event.reason;
      console.error(errorMsg);
      if (vscode) {
        vscode.postMessage({ command: 'log', message: errorMsg });
      }
    };
    
    if (vscode) {
      vscode.postMessage({ command: 'log', message: 'Query panel script loaded, autoRun=' + autoRun });
    }
    
    // Visual indicator that JS is running
    const msgContainer = document.getElementById('messageContainer');
    if (msgContainer) {
      msgContainer.innerHTML = '<div style="padding: 8px; background: #00ff0033; color: green;">JavaScript loaded successfully</div>';
      setTimeout(() => { msgContainer.innerHTML = ''; }, 2000);
    }
    
    let currentResult = null;
    let currentSql = '';
    let editingCell = null;
    let selectedRowIndex = null;
    let filterText = '';
    let sortColumn = '';
    let sortDirection = 'asc';
    let isEditorCollapsed = false;
    let renderedRows = [];
    let isRunning = false;
    let pendingTimer = null;

    function getEl(id) {
      const el = document.getElementById(id);
      if (!el) {
        document.body.innerHTML = '<div class=\"message message-error\" style=\"margin:12px;\">Missing UI element: ' + id + '</div>';
        throw new Error('Missing UI element: ' + id);
      }
      return el;
    }

    const sqlEditor = getEl('sqlEditor');
    const executeBtn = getEl('executeBtn');
    const editorSection = document.querySelector('.editor-section');
    const toggleEditorBtn = getEl('toggleEditorBtn');
    const ddlBtn = getEl('ddlBtn');
    const exportBtn = getEl('exportBtn');
    const orderBySelect = getEl('orderBySelect');
    const orderDirBtn = getEl('orderDirBtn');
    const rowFilterInput = getEl('rowFilterInput');
    const tableContainer = getEl('tableContainer');
    const resultsInfo = getEl('resultsInfo');
    const messageContainer = getEl('messageContainer');
    const resultsActions = getEl('resultsActions');
    const addRowBtn = getEl('addRowBtn');

    function initHandlers() {
      executeBtn.addEventListener('click', executeQuery);
      toggleEditorBtn.addEventListener('click', () => setEditorCollapsed(!isEditorCollapsed));
      ddlBtn.addEventListener('click', () => requestDdl());
      exportBtn.addEventListener('click', exportCsv);
      orderBySelect.addEventListener('change', () => {
        sortColumn = orderBySelect.value;
        renderTable(currentResult);
      });
      orderDirBtn.addEventListener('click', () => {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        orderDirBtn.textContent = sortDirection.toUpperCase();
        renderTable(currentResult);
      });
      rowFilterInput.addEventListener('input', () => {
        filterText = rowFilterInput.value.toLowerCase();
        renderTable(currentResult);
      });

      sqlEditor.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
          e.preventDefault();
          executeQuery();
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
          e.preventDefault();
          executeQuery();
        }
      });

      addRowBtn.addEventListener('click', () => {
        if (currentResult && currentResult.columns.length > 0) {
          showAddRowForm();
        }
      });
    }

    initHandlers();
    setRunning(false);

    function executeQuery() {
      const sql = sqlEditor.value.trim();
      if (!sql) return;
      
      currentSql = sql;
      setRunning(true, 'Executing query...');
      vscode.postMessage({ command: 'log', message: 'executeQuery invoked' });
      if (pendingTimer) {
        clearTimeout(pendingTimer);
      }
      pendingTimer = setTimeout(() => {
        setRunning(false, 'Query timed out. No response from extension.');
      }, 15000);
      
      vscode.postMessage({
        command: 'executeQuery',
        sql: sql
      });
    }

    function setRunning(running, message) {
      isRunning = running;
      executeBtn.disabled = running;
      ddlBtn.disabled = running;
      addRowBtn.disabled = running;
      resultsInfo.textContent = running ? 'Running...' : resultsInfo.textContent;
      if (message) {
        showMessage(message, running ? 'info' : 'success');
      }
    }

    function requestDdl() {
      const tableMatch = currentSql.match(/FROM\s+["'\`]?([\w.]+)["'\`]?/i);
      if (!tableMatch) {
        showMessage('Run a SELECT query first to infer the table for DDL.', 'error');
        return;
      }

      const tableParts = tableMatch[1].split('.');
      const table = tableParts[tableParts.length - 1].replace(/["'\`]/g, '');
      const schema = tableParts.length > 1 ? tableParts[0].replace(/["'\`]/g, '') : undefined;

      vscode.postMessage({
        command: 'getDDL',
        table,
        schema
      });
    }

    function setEditorCollapsed(collapsed) {
      isEditorCollapsed = collapsed;
      if (editorSection) {
        editorSection.classList.toggle('collapsed', collapsed);
      }
      toggleEditorBtn.textContent = collapsed ? 'Show SQL' : 'Hide SQL';
    }

    function updateOrderControls(result) {
      if (!result || !result.columns || result.columns.length === 0) {
        orderBySelect.innerHTML = '<option value="">None</option>';
        orderBySelect.disabled = true;
        orderDirBtn.disabled = true;
        exportBtn.disabled = true;
        return;
      }

      orderBySelect.disabled = false;
      orderDirBtn.disabled = false;
      exportBtn.disabled = false;

      const currentValue = orderBySelect.value;
      orderBySelect.innerHTML = '<option value="">None</option>';
      let hasSortColumn = false;
      result.columns.forEach(col => {
        const opt = document.createElement('option');
        opt.value = col;
        opt.textContent = col;
        if (col === currentValue) {
          opt.selected = true;
          hasSortColumn = true;
        }
        orderBySelect.appendChild(opt);
      });

      if (sortColumn && !result.columns.includes(sortColumn)) {
        sortColumn = '';
        orderBySelect.value = '';
      } else if (!hasSortColumn && currentValue === '') {
        orderBySelect.value = '';
      }
    }

    function getFilteredRows(result) {
      if (!result || !result.rows) {
        return [];
      }

      let rows = result.rows;
      if (filterText) {
        rows = rows.filter(row => {
          return result.columns.some(col => {
            const value = row[col];
            if (value === null || value === undefined) return false;
            return String(value).toLowerCase().includes(filterText);
          });
        });
      }

      if (sortColumn) {
        rows = [...rows].sort((a, b) => {
          const aVal = a[sortColumn];
          const bVal = b[sortColumn];
          if (aVal === bVal) return 0;
          if (aVal === null || aVal === undefined) return sortDirection === 'asc' ? 1 : -1;
          if (bVal === null || bVal === undefined) return sortDirection === 'asc' ? -1 : 1;
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
          }
          return sortDirection === 'asc'
            ? String(aVal).localeCompare(String(bVal))
            : String(bVal).localeCompare(String(aVal));
        });
      }

      return rows;
    }

    function exportCsv() {
      if (!currentResult || !currentResult.columns) return;
      const rows = getFilteredRows(currentResult);
      const headers = currentResult.columns;
      const csvLines = [];
      csvLines.push(headers.join(','));
      rows.forEach(row => {
        const line = headers.map(col => {
          const value = row[col];
          if (value === null || value === undefined) return '';
          const escaped = String(value).replace(/"/g, '""');
          return '"' + escaped + '"';
        }).join(',');
        csvLines.push(line);
      });
      const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'query_results.csv';
      link.click();
      URL.revokeObjectURL(url);
    }

    function showMessage(text, type = 'info') {
      const className = type === 'error' ? 'message-error' : 
                       type === 'success' ? 'message-success' : '';
      messageContainer.innerHTML = className ? 
        '<div class="message ' + className + '">' + escapeHtml(text) + '</div>' : '';
      
      if (type !== 'error') {
        setTimeout(() => {
          if (messageContainer.textContent.includes(text)) {
            messageContainer.innerHTML = '';
          }
        }, 3000);
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function renderTable(result) {
      if (!result || !result.rows || result.rows.length === 0) {
        tableContainer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><p>Query returned no rows</p></div>';
        resultsInfo.textContent = result && result.affectedRows !== undefined ? 
          result.affectedRows + ' row(s) affected' : 'No results';
        resultsActions.style.display = 'none';
        updateOrderControls(result);
        renderedRows = [];
        return;
      }

      const filteredRows = getFilteredRows(result);
      const totalCount = result.rows.length;
      const filteredCount = filteredRows.length;
      renderedRows = filteredRows;
      resultsInfo.textContent = filteredCount === totalCount
        ? totalCount + ' row(s) returned'
        : filteredCount + ' row(s) (filtered from ' + totalCount + ')';
      resultsActions.style.display = 'flex';
      updateOrderControls(result);

      let html = '<table><thead><tr>';
      html += '<th style="width: 50px;">#</th>';
      
      for (const col of result.columns) {
        const sortMarker = sortColumn === col ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '';
        html += '<th data-column="' + escapeHtml(col) + '">' + escapeHtml(col) + sortMarker + '</th>';
      }
      html += '<th style="width: 100px;">Actions</th>';
      html += '</tr></thead><tbody>';

      filteredRows.forEach((row, rowIndex) => {
        html += '<tr data-row-index="' + rowIndex + '">';
        html += '<td style="color: var(--text-secondary);">' + (rowIndex + 1) + '</td>';
        
        for (const col of result.columns) {
          const value = row[col];
          const displayValue = value === null ? '<em style="color: var(--text-secondary);">NULL</em>' : escapeHtml(String(value));
          html += '<td class="cell-editable" data-column="' + escapeHtml(col) + '" data-row-index="' + rowIndex + '">' + displayValue + '</td>';
        }

        html += '<td><div class="row-actions">';
        html += '<button class="btn btn-secondary row-action-btn" onclick="deleteRow(' + rowIndex + ')">Delete</button>';
        html += '</div></td>';
        html += '</tr>';
      });

      html += '</tbody></table>';
      tableContainer.innerHTML = html;

      document.querySelectorAll('th[data-column]').forEach(th => {
        th.addEventListener('click', () => {
          const col = th.getAttribute('data-column');
          if (!col) return;
          if (sortColumn === col) {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            sortColumn = col;
            sortDirection = 'asc';
          }
          orderBySelect.value = col;
          orderDirBtn.textContent = sortDirection.toUpperCase();
          renderTable(currentResult);
        });
      });

      // Add cell click handlers for inline editing
      document.querySelectorAll('.cell-editable').forEach(cell => {
        cell.addEventListener('dblclick', (e) => startEditing(e.target));
      });
    }

    function startEditing(cell) {
      if (editingCell) {
        finishEditing(editingCell, false);
      }

      const column = cell.dataset.column;
      const rowIndex = parseInt(cell.dataset.rowIndex);
      const currentValue = renderedRows[rowIndex][column];

      editingCell = cell;
      selectedRowIndex = rowIndex;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'cell-input';
      input.value = currentValue === null ? '' : String(currentValue);
      input.dataset.originalValue = currentValue === null ? '' : String(currentValue);
      input.dataset.column = column;
      input.dataset.rowIndex = String(rowIndex);

      input.addEventListener('blur', () => finishEditing(cell, true));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          finishEditing(cell, true);
        } else if (e.key === 'Escape') {
          finishEditing(cell, false);
        }
      });

      cell.innerHTML = '';
      cell.appendChild(input);
      input.focus();
      input.select();
    }

    function finishEditing(cell, save) {
      const input = cell.querySelector('input');
      if (!input) return;

      const newValue = input.value;
      const originalValue = input.dataset.originalValue;
      const column = input.dataset.column;
      const rowIndex = parseInt(input.dataset.rowIndex);

      editingCell = null;

      if (save && newValue !== originalValue) {
        // Update the row
        const row = renderedRows[rowIndex];
        const primaryKeys = detectPrimaryKeys(row);
        const data = { [column]: newValue === '' ? null : newValue };

        const tableMatch = currentSql.match(/FROM\\s+["'\`]?([\\w.]+)["'\`]?/i);
        if (tableMatch) {
          const tableParts = tableMatch[1].split('.');
          const table = tableParts[tableParts.length - 1].replace(/["'\`]/g, '');
          const schema = tableParts.length > 1 ? tableParts[0].replace(/["'\`]/g, '') : undefined;

          vscode.postMessage({
            command: 'updateRow',
            table,
            schema,
            primaryKeys,
            data
          });
        }
      }

      const value = renderedRows[rowIndex][column];
      cell.innerHTML = value === null ? '<em style="color: var(--text-secondary);">NULL</em>' : escapeHtml(String(value));
    }

    function detectPrimaryKeys(row) {
      // Simple heuristic: use 'id' column if exists, otherwise first column
      const keys = {};
      if ('id' in row) {
        keys['id'] = row['id'];
      } else if (currentResult.columns.length > 0) {
        const firstCol = currentResult.columns[0];
        keys[firstCol] = row[firstCol];
      }
      return keys;
    }

    window.deleteRow = function(rowIndex) {
      const row = renderedRows[rowIndex];
      const primaryKeys = detectPrimaryKeys(row);

      const tableMatch = currentSql.match(/FROM\\s+["'\`]?([\\w.]+)["'\`]?/i);
      if (tableMatch) {
        const tableParts = tableMatch[1].split('.');
        const table = tableParts[tableParts.length - 1].replace(/["'\`]/g, '');
        const schema = tableParts.length > 1 ? tableParts[0].replace(/["'\`]/g, '') : undefined;

        if (confirm('Are you sure you want to delete this row?')) {
          vscode.postMessage({
            command: 'deleteRow',
            table,
            schema,
            primaryKeys
          });
        }
      }
    };

    function showAddRowForm() {
      const tableMatch = currentSql.match(/FROM\\s+["'\`]?([\\w.]+)["'\`]?/i);
      if (!tableMatch) {
        showMessage('Cannot determine table name from query', 'error');
        return;
      }

      const tableParts = tableMatch[1].split('.');
      const table = tableParts[tableParts.length - 1].replace(/["'\`]/g, '');
      const schema = tableParts.length > 1 ? tableParts[0].replace(/["'\`]/g, '') : undefined;

      const data = {};
      for (const col of currentResult.columns) {
        const value = prompt('Enter value for ' + col + ' (leave empty for NULL):');
        if (value === null) return; // Cancelled
        data[col] = value === '' ? null : value;
      }

      vscode.postMessage({
        command: 'insertRow',
        table,
        schema,
        data
      });
    }

    // Handle messages from extension
    window.addEventListener('message', event => {
      const message = event.data;
      
      switch (message.type) {
        case 'queryResult':
          currentResult = message.result;
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
          }
          setRunning(false, 'Query executed successfully');
          renderTable(message.result);
          setEditorCollapsed(true);
          break;
        case 'ddlResult':
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
          }
          setRunning(false);
          sqlEditor.value = message.ddl;
          setEditorCollapsed(false);
          showMessage('DDL loaded into SQL editor', 'success');
          break;
        case 'error':
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
          }
          setRunning(false);
          showMessage(message.message, 'error');
          break;
        case 'rowInserted':
        case 'rowUpdated':
        case 'rowDeleted':
          showMessage('Operation successful', 'success');
          // Re-execute query to refresh
          executeQuery();
          break;
      }
    });

    if (autoRun && sqlEditor.value.trim()) {
      setTimeout(() => executeQuery(), 0);
    }
  </script>
</body>
</html>`;
  }

  public dispose(): void {
    QueryPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/`/g, '&#96;')      // Escape backticks for template literals
    .replace(/\\/g, '&#92;')     // Escape backslashes
    .replace(/\$/g, '&#36;');    // Escape $ to prevent ${} interpolation
}
