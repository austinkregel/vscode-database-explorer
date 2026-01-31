import * as vscode from 'vscode';
import { ConnectionStore } from './storage/connectionStore';
import { DriverRegistry } from './drivers/driverRegistry';
import { ExplorerTreeProvider, ExplorerTreeItem } from './views/explorerTree';
import { QueryPanel } from './views/queryPanel';
import { TableStatusBar } from './views/statusBar';
import { ConnectionConfig, DbDriver, TreeNodeData, LastViewedTable } from './types';
import { logger } from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';

let explorerTreeProvider: ExplorerTreeProvider;
let connectionStore: ConnectionStore;
let driverRegistry: DriverRegistry;
let tableStatusBar: TableStatusBar;
let lastClickId: string | null = null;
let lastClickAt = 0;

export function activate(context: vscode.ExtensionContext) {
	// Initialize logger first
	logger.init(context);
	logger.info('Database Explorer is activating...');

	// Initialize core services
	connectionStore = new ConnectionStore(context);
	driverRegistry = new DriverRegistry(connectionStore);
	explorerTreeProvider = new ExplorerTreeProvider(connectionStore, driverRegistry);
	tableStatusBar = new TableStatusBar(context);
	updateConnectionsContext();
	
	// Log any driver loading errors
	const driverErrors = driverRegistry.getAllDriverLoadErrors();
	if (driverErrors.size > 0) {
		for (const [driver, error] of driverErrors) {
			logger.warn(`Driver "${driver}" failed to load: ${error}`);
		}
	}
	
	logger.info(`Loaded ${driverRegistry.getAvailableDrivers().length} database drivers`);

	// Register tree view
	const treeView = vscode.window.createTreeView<ExplorerTreeItem>('databaseExplorer', {
		treeDataProvider: explorerTreeProvider,
		showCollapseAll: true
	});
	context.subscriptions.push(treeView);

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand('database-explorer.addConnection', () => addConnection()),
		vscode.commands.registerCommand('database-explorer.editConnection', (node: vscode.TreeItem) => editConnection(node)),
		vscode.commands.registerCommand('database-explorer.removeConnection', (node: vscode.TreeItem) => removeConnection(node)),
		vscode.commands.registerCommand('database-explorer.connect', (node: vscode.TreeItem) => connectToDatabase(node)),
		vscode.commands.registerCommand('database-explorer.disconnect', (node: vscode.TreeItem) => disconnectFromDatabase(node)),
		vscode.commands.registerCommand('database-explorer.openQuery', (node: vscode.TreeItem) => openQueryPanel(node, context)),
		vscode.commands.registerCommand('database-explorer.openQueryLimit250', (node: vscode.TreeItem) => openQueryPanel(node, context, 250, true)),
		vscode.commands.registerCommand('database-explorer.openDDL', (node: vscode.TreeItem) => openDDLPanel(node, context)),
		vscode.commands.registerCommand('database-explorer.countRows', (node: vscode.TreeItem) => countRows(node, context)),
		vscode.commands.registerCommand('database-explorer.previewTop100', (node: vscode.TreeItem) => openQueryPanel(node, context, 100, true)),
		vscode.commands.registerCommand('database-explorer.exportCsv', (node: vscode.TreeItem) => exportCsv(node)),
		vscode.commands.registerCommand('database-explorer.copyTableName', (node: vscode.TreeItem) => copyTableName(node, false)),
		vscode.commands.registerCommand('database-explorer.copyQualifiedName', (node: vscode.TreeItem) => copyTableName(node, true)),
		vscode.commands.registerCommand('database-explorer.copyColumnNames', (node: vscode.TreeItem) => copyColumnNames(node)),
		vscode.commands.registerCommand('database-explorer.refreshTable', () => explorerTreeProvider.refresh()),
		vscode.commands.registerCommand('database-explorer.deleteRows', (node: vscode.TreeItem) => deleteRows(node)),
		vscode.commands.registerCommand('database-explorer.truncateTable', (node: vscode.TreeItem) => truncateTable(node)),
		vscode.commands.registerCommand('database-explorer.dropTable', (node: vscode.TreeItem) => dropTable(node)),
		vscode.commands.registerCommand('database-explorer.dropView', (node: vscode.TreeItem) => dropView(node)),
		vscode.commands.registerCommand('database-explorer.refreshExplorer', () => explorerTreeProvider.refresh()),
		vscode.commands.registerCommand('database-explorer.itemClick', (node: ExplorerTreeItem) => handleItemClick(node, context, treeView)),
		vscode.commands.registerCommand('database-explorer.reopenLastTable', () => reopenLastTable(context)),
		vscode.commands.registerCommand('database-explorer.openSettings', () => openSettings()),
		vscode.commands.registerCommand('database-explorer.showLogs', () => logger.show())
	);
	
	logger.info('Database Explorer activated successfully');

	treeView.onDidExpandElement((event) => {
		const element = event.element;
		const nodeData = element.nodeData;
		if (nodeData.type !== 'table' && nodeData.type !== 'view') {
			return;
		}

		const now = Date.now();
		const clickId = `${nodeData.connectionId}:${nodeData.schema ?? ''}:${nodeData.table ?? nodeData.label}:${nodeData.type}`;
		const doubleClickWindowMs = 400;
		if (lastClickId === clickId && now - lastClickAt <= doubleClickWindowMs) {
			// Collapse if the expand was triggered by a double-click on the label
			void treeView.reveal(element, { expand: false, select: true, focus: false });
		}
	});
}

async function addConnection(): Promise<void> {
	// Get available drivers dynamically from the factory
	const availableDrivers = driverRegistry.getAvailableDrivers();
	const typeOptions: vscode.QuickPickItem[] = availableDrivers.map(driver => ({
		label: driver.displayName,
		description: driver.id,
		detail: `Category: ${driver.category}${driver.defaultPort ? ` | Default port: ${driver.defaultPort}` : ''}`
	}));

	const selectedType = await vscode.window.showQuickPick(typeOptions, {
		placeHolder: 'Select database type'
	});

	if (!selectedType) {
		return;
	}

	const dbType = selectedType.description as string;

	const name = await vscode.window.showInputBox({
		prompt: 'Connection name',
		placeHolder: 'My Database'
	});

	if (!name) {
		return;
	}

	let config: ConnectionConfig;

	if (dbType === 'sqlite') {
		const fileUri = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			filters: { 'SQLite Database': ['db', 'sqlite', 'sqlite3'] },
			title: 'Select SQLite Database File'
		});

		if (!fileUri || fileUri.length === 0) {
			return;
		}

		config = {
			id: generateId(),
			name,
			type: 'sqlite',
			database: fileUri[0].fsPath,
			filepath: fileUri[0].fsPath
		};
	} else {
		// Get default port from driver metadata
		const driverMetadata = driverRegistry.getDriverMetadata(dbType);
		const defaultPort = driverMetadata?.defaultPort?.toString() || '5432';
		
		const host = await vscode.window.showInputBox({
			prompt: 'Host',
			placeHolder: 'localhost',
			value: 'localhost'
		});

		if (!host) {
			return;
		}

		const portStr = await vscode.window.showInputBox({
			prompt: 'Port',
			placeHolder: defaultPort,
			value: defaultPort
		});

		if (!portStr) {
			return;
		}

		const database = await vscode.window.showInputBox({
			prompt: 'Database name',
			placeHolder: dbType === 'mssql' ? 'master' : 'mydb'
		});

		if (!database) {
			return;
		}

		// Get default username based on driver
		let defaultUsername = 'root';
		if (dbType === 'postgres') { defaultUsername = 'postgres'; }
		else if (dbType === 'mssql') { defaultUsername = 'sa'; }

		const username = await vscode.window.showInputBox({
			prompt: 'Username',
			placeHolder: defaultUsername
		});

		if (!username) {
			return;
		}

		const password = await vscode.window.showInputBox({
			prompt: 'Password',
			password: true
		});

		config = {
			id: generateId(),
			name,
			type: dbType,
			host,
			port: parseInt(portStr, 10),
			database,
			username
		};

		if (password) {
			await connectionStore.savePassword(config.id, password);
		}
	}

	await connectionStore.addConnection(config);
	explorerTreeProvider.refresh();
	updateConnectionsContext();
	vscode.window.showInformationMessage(`Connection "${name}" added successfully.`);
}

async function editConnection(node: vscode.TreeItem): Promise<void> {
	const nodeData = node as unknown as { nodeData?: TreeNodeData };
	if (!nodeData.nodeData) {
		return;
	}

	const connectionId = nodeData.nodeData.connectionId;
	const connection = await connectionStore.getConnection(connectionId);

	if (!connection) {
		return;
	}

	const name = await vscode.window.showInputBox({
		prompt: 'Connection name',
		value: connection.name
	});

	if (!name) {
		return;
	}

	connection.name = name;

	if (connection.type !== 'sqlite') {
		const host = await vscode.window.showInputBox({
			prompt: 'Host',
			value: connection.host
		});

		if (!host) {
			return;
		}

		const portStr = await vscode.window.showInputBox({
			prompt: 'Port',
			value: connection.port?.toString()
		});

		if (!portStr) {
			return;
		}

		const database = await vscode.window.showInputBox({
			prompt: 'Database name',
			value: connection.database
		});

		if (!database) {
			return;
		}

		const username = await vscode.window.showInputBox({
			prompt: 'Username',
			value: connection.username
		});

		if (!username) {
			return;
		}

		const password = await vscode.window.showInputBox({
			prompt: 'Password (leave empty to keep existing)',
			password: true
		});

		connection.host = host;
		connection.port = parseInt(portStr, 10);
		connection.database = database;
		connection.username = username;

		if (password) {
			await connectionStore.savePassword(connection.id, password);
		}
	}

	await connectionStore.updateConnection(connection);
	explorerTreeProvider.refresh();
	vscode.window.showInformationMessage(`Connection "${name}" updated.`);
}

async function removeConnection(node: vscode.TreeItem): Promise<void> {
	const nodeData = node as unknown as { nodeData?: TreeNodeData };
	if (!nodeData.nodeData) {
		return;
	}

	const connectionId = nodeData.nodeData.connectionId;
	const connection = await connectionStore.getConnection(connectionId);

	if (!connection) {
		return;
	}

	const confirm = await vscode.window.showWarningMessage(
		`Are you sure you want to remove "${connection.name}"?`,
		{ modal: true },
		'Remove'
	);

	if (confirm === 'Remove') {
		await driverRegistry.disconnect(connectionId);
		await connectionStore.removeConnection(connectionId);
		explorerTreeProvider.refresh();
		updateConnectionsContext();
		vscode.window.showInformationMessage(`Connection "${connection.name}" removed.`);
	}
}

async function connectToDatabase(node: vscode.TreeItem): Promise<void> {
	const nodeData = node as unknown as { nodeData?: TreeNodeData };
	if (!nodeData.nodeData) {
		return;
	}

	const connectionId = nodeData.nodeData.connectionId;

	try {
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Connecting to database...',
				cancellable: false
			},
			async () => {
				await driverRegistry.connect(connectionId);
			}
		);
		explorerTreeProvider.refresh();
		vscode.window.showInformationMessage('Connected successfully!');
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function disconnectFromDatabase(node: vscode.TreeItem): Promise<void> {
	const nodeData = node as unknown as { nodeData?: TreeNodeData };
	if (!nodeData.nodeData) {
		return;
	}

	const connectionId = nodeData.nodeData.connectionId;

	try {
		await driverRegistry.disconnect(connectionId);
		explorerTreeProvider.refresh();
		vscode.window.showInformationMessage('Disconnected.');
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to disconnect: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function openQueryPanel(node: vscode.TreeItem, context: vscode.ExtensionContext, limit = 100, autoRun = false): void {
	const nodeData = node as unknown as { nodeData?: TreeNodeData };
	if (!nodeData.nodeData) {
		return;
	}

	const connectionId = nodeData.nodeData.connectionId;
	const driver = driverRegistry.getDriver(connectionId);

	if (!driver) {
		vscode.window.showErrorMessage('Please connect to the database first.');
		return;
	}

	const connection = connectionStore.getConnectionSync(connectionId);
	if (!connection) {
		return;
	}

	let initialQuery = '';
	if ((nodeData.nodeData.type === 'table' || nodeData.nodeData.type === 'view') && nodeData.nodeData.table) {
		const tableName = nodeData.nodeData.schema
			? `${nodeData.nodeData.schema}.${nodeData.nodeData.table}`
			: `${nodeData.nodeData.table}`;
		initialQuery = `SELECT * FROM ${tableName} LIMIT ${limit};`;

		// Update the status bar with the last viewed table
		const lastViewed: LastViewedTable = {
			connectionId: connection.id,
			connectionName: connection.name,
			schema: nodeData.nodeData.schema,
			table: nodeData.nodeData.table,
			query: initialQuery,
			timestamp: Date.now()
		};
		tableStatusBar.setLastViewed(lastViewed);
	}

	QueryPanel.createOrShow(context.extensionUri, connection, driver, initialQuery, autoRun);
}

/**
 * Reopen the last viewed table from the status bar
 */
async function reopenLastTable(context: vscode.ExtensionContext): Promise<void> {
	const lastViewed = tableStatusBar.getLastViewed();
	if (!lastViewed) {
		vscode.window.showInformationMessage('No recently viewed table.');
		return;
	}

	// Get the connection
	const connection = connectionStore.getConnectionSync(lastViewed.connectionId);
	if (!connection) {
		vscode.window.showErrorMessage(`Connection "${lastViewed.connectionName}" not found.`);
		tableStatusBar.clear();
		return;
	}

	// Ensure connection is active
	let driver = driverRegistry.getDriver(lastViewed.connectionId);
	if (!driver || !driver.isConnected()) {
		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Connecting to ${connection.name}...`,
					cancellable: false
				},
				async () => {
					driver = await driverRegistry.connect(lastViewed.connectionId);
				}
			);
			explorerTreeProvider.refresh();
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
	}

	if (!driver) {
		vscode.window.showErrorMessage('Failed to establish connection.');
		return;
	}

	// Open the query panel with the last query
	QueryPanel.createOrShow(context.extensionUri, connection, driver, lastViewed.query, true);
}

async function openDDLPanel(node: vscode.TreeItem, context: vscode.ExtensionContext): Promise<void> {
	const nodeData = node as unknown as { nodeData?: TreeNodeData };
	if (!nodeData.nodeData) {
		return;
	}

	if (nodeData.nodeData.type !== 'table' && nodeData.nodeData.type !== 'view') {
		return;
	}

	const connectionId = nodeData.nodeData.connectionId;
	const driver = driverRegistry.getDriver(connectionId);
	if (!driver) {
		vscode.window.showErrorMessage('Please connect to the database first.');
		return;
	}

	const connection = connectionStore.getConnectionSync(connectionId);
	if (!connection) {
		return;
	}

	const table = nodeData.nodeData.table ?? nodeData.nodeData.label;
	const schema = nodeData.nodeData.schema;

	try {
		const ddl = await driver.getDDL(table, schema);
		QueryPanel.createOrShow(context.extensionUri, connection, driver, ddl, false);
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to fetch DDL: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function countRows(node: vscode.TreeItem, context: vscode.ExtensionContext): Promise<void> {
	const tableInfo = getTableInfo(node);
	if (!tableInfo) {
		return;
	}

	const { connection, driver, schema, table } = tableInfo;
	const qualifiedName = schema ? `${schema}.${table}` : table;
	const sql = `SELECT COUNT(*) AS count FROM ${qualifiedName};`;
	QueryPanel.createOrShow(context.extensionUri, connection, driver, sql, true);
}

async function exportCsv(node: vscode.TreeItem): Promise<void> {
	const tableInfo = getTableInfo(node);
	if (!tableInfo) {
		return;
	}

	const { driver, schema, table } = tableInfo;
	const qualifiedName = schema ? `${schema}.${table}` : table;
	const defaultLimit = '1000';
	const limitInput = await vscode.window.showInputBox({
		prompt: 'Export CSV row limit',
		value: defaultLimit
	});

	if (!limitInput) {
		return;
	}

	const limit = Number(limitInput);
	if (!Number.isFinite(limit) || limit <= 0) {
		vscode.window.showErrorMessage('Invalid limit value.');
		return;
	}

	const sql = `SELECT * FROM ${qualifiedName} LIMIT ${limit};`;
	const result = await driver.executeQuery(sql);
	if (!result.columns.length) {
		vscode.window.showWarningMessage('No results to export.');
		return;
	}

	const rows = result.rows;
	const csvLines: string[] = [];
	csvLines.push(result.columns.join(','));
	for (const row of rows) {
		const line = result.columns.map((col) => {
			const value = row[col];
			if (value === null || value === undefined) {
				return '';
			}
			const escaped = String(value).replace(/"/g, '""');
			return `"${escaped}"`;
		}).join(',');
		csvLines.push(line);
	}

	const saveUri = await vscode.window.showSaveDialog({
		defaultUri: vscode.Uri.file(path.join(process.cwd(), `${table}.csv`)),
		filters: { CSV: ['csv'] }
	});

	if (!saveUri) {
		return;
	}

	fs.writeFileSync(saveUri.fsPath, csvLines.join('\n'), 'utf8');
	vscode.window.showInformationMessage(`Exported ${rows.length} row(s) to ${saveUri.fsPath}`);
}

async function copyTableName(node: vscode.TreeItem, qualified: boolean): Promise<void> {
	const tableInfo = getTableInfo(node);
	if (!tableInfo) {
		return;
	}

	const { schema, table } = tableInfo;
	const text = qualified && schema ? `${schema}.${table}` : table;
	await vscode.env.clipboard.writeText(text);
	vscode.window.showInformationMessage(`Copied ${qualified ? 'qualified ' : ''}table name.`);
}

async function copyColumnNames(node: vscode.TreeItem): Promise<void> {
	const tableInfo = getTableInfo(node);
	if (!tableInfo) {
		return;
	}

	const { driver, schema, table } = tableInfo;
	const columns = await driver.getColumns(table, schema);
	const names = columns.map((col) => col.name).join(', ');
	await vscode.env.clipboard.writeText(names);
	vscode.window.showInformationMessage('Copied column names.');
}

async function deleteRows(node: vscode.TreeItem): Promise<void> {
	const tableInfo = getTableInfo(node);
	if (!tableInfo) {
		return;
	}

	const { driver, schema, table } = tableInfo;
	const qualifiedName = schema ? `${schema}.${table}` : table;
	const whereClause = await vscode.window.showInputBox({
		prompt: 'Enter WHERE clause (without WHERE)',
		placeHolder: 'id = 1'
	});

	if (!whereClause) {
		return;
	}

	const confirm = await vscode.window.showWarningMessage(
		`Delete rows from ${qualifiedName} WHERE ${whereClause}?`,
		{ modal: true },
		'Delete'
	);
	if (confirm !== 'Delete') {
		return;
	}

	await driver.executeQuery(`DELETE FROM ${qualifiedName} WHERE ${whereClause};`);
	vscode.window.showInformationMessage('Rows deleted.');
}

async function truncateTable(node: vscode.TreeItem): Promise<void> {
	const tableInfo = getTableInfo(node);
	if (!tableInfo) {
		return;
	}

	const { driver, schema, table, connection } = tableInfo;
	const qualifiedName = schema ? `${schema}.${table}` : table;
	const confirm = await vscode.window.showWarningMessage(
		`Truncate table ${qualifiedName}? This cannot be undone.`,
		{ modal: true },
		'Truncate'
	);
	if (confirm !== 'Truncate') {
		return;
	}

	if (connection.type === 'sqlite') {
		await driver.executeQuery(`DELETE FROM ${qualifiedName};`);
	} else {
		await driver.executeQuery(`TRUNCATE TABLE ${qualifiedName};`);
	}
	vscode.window.showInformationMessage(`Truncated ${qualifiedName}.`);
}

async function dropTable(node: vscode.TreeItem): Promise<void> {
	const tableInfo = getTableInfo(node);
	if (!tableInfo) {
		return;
	}

	const { driver, schema, table } = tableInfo;
	const qualifiedName = schema ? `${schema}.${table}` : table;
	const confirm = await vscode.window.showWarningMessage(
		`Drop table ${qualifiedName}? This cannot be undone.`,
		{ modal: true },
		'Drop'
	);
	if (confirm !== 'Drop') {
		return;
	}

	await driver.executeQuery(`DROP TABLE ${qualifiedName};`);
	vscode.window.showInformationMessage(`Dropped ${qualifiedName}.`);
	explorerTreeProvider.refresh();
}

async function dropView(node: vscode.TreeItem): Promise<void> {
	const tableInfo = getTableInfo(node);
	if (!tableInfo) {
		return;
	}

	const { driver, schema, table } = tableInfo;
	const qualifiedName = schema ? `${schema}.${table}` : table;
	const confirm = await vscode.window.showWarningMessage(
		`Drop view ${qualifiedName}? This cannot be undone.`,
		{ modal: true },
		'Drop'
	);
	if (confirm !== 'Drop') {
		return;
	}

	await driver.executeQuery(`DROP VIEW ${qualifiedName};`);
	vscode.window.showInformationMessage(`Dropped ${qualifiedName}.`);
	explorerTreeProvider.refresh();
}

function getTableInfo(node: vscode.TreeItem): { connection: ConnectionConfig; driver: DbDriver; schema?: string; table: string } | null {
	const nodeData = node as unknown as { nodeData?: TreeNodeData };
	if (!nodeData.nodeData) {
		return null;
	}

	if (nodeData.nodeData.type !== 'table' && nodeData.nodeData.type !== 'view') {
		return null;
	}

	const connectionId = nodeData.nodeData.connectionId;
	const driver = driverRegistry.getDriver(connectionId);
	if (!driver) {
		vscode.window.showErrorMessage('Please connect to the database first.');
		return null;
	}

	const connection = connectionStore.getConnectionSync(connectionId);
	if (!connection) {
		return null;
	}

	const table = nodeData.nodeData.table ?? nodeData.nodeData.label;
	const schema = nodeData.nodeData.schema;
	return { connection, driver, schema, table };
}

function handleItemClick(
	node: ExplorerTreeItem,
	context: vscode.ExtensionContext,
	treeView: vscode.TreeView<ExplorerTreeItem>
): void {
	const nodeData = node.nodeData;
	if (nodeData.type !== 'table' && nodeData.type !== 'view' && nodeData.type !== 'connection') {
		return;
	}

	const now = Date.now();
	const clickId = `${nodeData.connectionId}:${nodeData.schema ?? ''}:${nodeData.table ?? nodeData.label}:${nodeData.type}`;

	const doubleClickWindowMs = 400;
	if (lastClickId === clickId && now - lastClickAt <= doubleClickWindowMs) {
		if (nodeData.type === 'connection') {
			void handleConnectionDoubleClick(node, context, treeView);
		} else {
			openQueryPanel(node, context, 250, true);
		}
		lastClickId = null;
		lastClickAt = 0;
		return;
	}

	lastClickId = clickId;
	lastClickAt = now;
}

async function handleConnectionDoubleClick(
	node: ExplorerTreeItem,
	context: vscode.ExtensionContext,
	treeView: vscode.TreeView<ExplorerTreeItem>
): Promise<void> {
	const nodeData = node.nodeData;
	if (nodeData.type !== 'connection') {
		return;
	}

	if (!driverRegistry.isConnected(nodeData.connectionId)) {
		await connectToDatabase(node);
	}

	explorerTreeProvider.refresh();
	await treeView.reveal(node, { expand: 4, focus: true, select: true });
}

function generateId(): string {
	return `conn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function openSettings(): void {
	// Open VS Code settings filtered to Database Explorer settings
	void vscode.commands.executeCommand('workbench.action.openSettings', 'databaseExplorer');
}

function updateConnectionsContext(): void {
	const hasConnections = connectionStore.getAllConnections().length > 0;
	void vscode.commands.executeCommand('setContext', 'databaseExplorer.hasConnections', hasConnections);
}

export function deactivate() {
	// Disconnect all connections on deactivation
	if (driverRegistry) {
		driverRegistry.disconnectAll();
	}
}
