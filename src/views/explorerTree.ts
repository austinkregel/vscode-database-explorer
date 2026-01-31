import * as vscode from 'vscode';
import { ConnectionStore } from '../storage/connectionStore';
import { DriverRegistry } from '../drivers/driverRegistry';
import { TreeNodeData, ConnectionConfig, SchemaInfo, TableInfo, ViewInfo, ColumnInfo, DriverCapabilities } from '../types';
import { getEffectiveCapabilities } from '../drivers/capabilities';

export class ExplorerTreeProvider implements vscode.TreeDataProvider<ExplorerTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ExplorerTreeItem | undefined | null | void> = new vscode.EventEmitter<ExplorerTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ExplorerTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(
    private connectionStore: ConnectionStore,
    private driverRegistry: DriverRegistry
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ExplorerTreeItem): vscode.TreeItem {
    return element;
  }

  getParent(element: ExplorerTreeItem): ExplorerTreeItem | undefined {
    const nodeData = element.nodeData;
    if (nodeData.type === 'connection') {
      return undefined;
    }

    const connection = this.connectionStore.getConnectionSync(nodeData.connectionId);
    if (!connection) {
      return undefined;
    }

    switch (nodeData.type) {
      case 'schema':
        return this.createConnectionNode(connection);
      case 'category':
        return this.createSchemaNode(nodeData.connectionId, { name: nodeData.schema || '' });
      case 'table':
        return this.createCategoryNode(nodeData.connectionId, nodeData.schema || '', 'tables');
      case 'view':
        return this.createCategoryNode(nodeData.connectionId, nodeData.schema || '', 'views');
      case 'column':
        if (nodeData.category === 'views') {
          return this.createViewNode(nodeData.connectionId, { name: nodeData.table || '', schema: nodeData.schema }, nodeData.schema || '');
        }
        return this.createTableNode(nodeData.connectionId, { name: nodeData.table || '', schema: nodeData.schema }, nodeData.schema || '');
      default:
        return undefined;
    }
  }

  async getChildren(element?: ExplorerTreeItem): Promise<ExplorerTreeItem[]> {
    if (!element) {
      // Root level - show connections
      return this.getConnectionNodes();
    }

    const nodeData = element.nodeData;

    switch (nodeData.type) {
      case 'connection':
        return this.getSchemaNodes(nodeData.connectionId);
      case 'schema':
        return this.getCategoryNodes(nodeData.connectionId, nodeData.schema!);
      case 'category':
        if (nodeData.category === 'tables') {
          return this.getTableNodes(nodeData.connectionId, nodeData.schema!);
        }
        if (nodeData.category === 'views') {
          return this.getViewNodes(nodeData.connectionId, nodeData.schema!);
        }
        return [];
      case 'table':
        return this.getColumnNodes(nodeData.connectionId, nodeData.table!, nodeData.schema, 'tables');
      case 'view':
        return this.getColumnNodes(nodeData.connectionId, nodeData.table!, nodeData.schema, 'views');
      default:
        return [];
    }
  }

  private getConnectionNodes(): ExplorerTreeItem[] {
    const connections = this.connectionStore.getAllConnections();
    return connections.map(conn => this.createConnectionNode(conn));
  }

  private createConnectionNode(conn: ConnectionConfig): ExplorerTreeItem {
    const isConnected = this.driverRegistry.isConnected(conn.id);
    const description = conn.type === 'sqlite' 
      ? conn.filepath 
      : `${conn.host}:${conn.port}/${conn.database}`;

    const nodeData: TreeNodeData = {
      type: 'connection',
      connectionId: conn.id,
      label: conn.name,
      isConnected
    };

    const item = new ExplorerTreeItem(
      conn.name,
      vscode.TreeItemCollapsibleState.Collapsed,
      nodeData
    );

    item.description = description;
    item.contextValue = isConnected ? 'connection-connected' : 'connection-disconnected';
    item.iconPath = new vscode.ThemeIcon(
      isConnected ? 'database' : 'circle-outline',
      isConnected ? new vscode.ThemeColor('charts.green') : undefined
    );
    item.command = {
      command: 'database-explorer.itemClick',
      title: 'Select',
      arguments: [item]
    };

    return item;
  }

  private async getSchemaNodes(connectionId: string): Promise<ExplorerTreeItem[]> {
    const driver = this.driverRegistry.getDriver(connectionId);
    if (!driver) {
      return [];
    }

    try {
      const schemas = await driver.getSchemas();
      return schemas.map(schema => this.createSchemaNode(connectionId, schema));
    } catch (error) {
      console.error('Error fetching schemas:', error);
      return [];
    }
  }

  private createSchemaNode(connectionId: string, schema: SchemaInfo): ExplorerTreeItem {
    const nodeData: TreeNodeData = {
      type: 'schema',
      connectionId,
      label: schema.name,
      schema: schema.name
    };

    const item = new ExplorerTreeItem(
      schema.name,
      vscode.TreeItemCollapsibleState.Collapsed,
      nodeData
    );

    item.contextValue = 'schema';
    item.iconPath = new vscode.ThemeIcon('folder');

    return item;
  }

  private getCategoryNodes(connectionId: string, schema: string): ExplorerTreeItem[] {
    const tablesNode = this.createCategoryNode(connectionId, schema, 'tables');
    const viewsNode = this.createCategoryNode(connectionId, schema, 'views');
    return [tablesNode, viewsNode];
  }

  private createCategoryNode(connectionId: string, schema: string, category: 'tables' | 'views'): ExplorerTreeItem {
    const label = category === 'tables' ? 'Tables' : 'Views';
    const nodeData: TreeNodeData = {
      type: 'category',
      connectionId,
      label,
      schema,
      category
    };

    const item = new ExplorerTreeItem(
      label,
      vscode.TreeItemCollapsibleState.Collapsed,
      nodeData
    );

    item.contextValue = `category-${category}`;
    item.iconPath = new vscode.ThemeIcon(category === 'tables' ? 'folder' : 'eye');

    return item;
  }

  private async getTableNodes(connectionId: string, schema: string): Promise<ExplorerTreeItem[]> {
    const driver = this.driverRegistry.getDriver(connectionId);
    if (!driver) {
      return [];
    }

    try {
      const tables = await driver.getTables(schema);
      return tables.map(table => this.createTableNode(connectionId, table, schema));
    } catch (error) {
      console.error('Error fetching tables:', error);
      return [];
    }
  }

  private async getViewNodes(connectionId: string, schema: string): Promise<ExplorerTreeItem[]> {
    const driver = this.driverRegistry.getDriver(connectionId);
    if (!driver) {
      return [];
    }

    try {
      const views = await driver.getViews(schema);
      return views.map(view => this.createViewNode(connectionId, view, schema));
    } catch (error) {
      console.error('Error fetching views:', error);
      return [];
    }
  }

  private createTableNode(connectionId: string, table: TableInfo, schema: string): ExplorerTreeItem {
    const nodeData: TreeNodeData = {
      type: 'table',
      connectionId,
      label: table.name,
      schema,
      table: table.name
    };

    const item = new ExplorerTreeItem(
      table.name,
      vscode.TreeItemCollapsibleState.Collapsed,
      nodeData
    );

    // Build context value with capability flags
    const contextParts = ['table'];
    const capabilities = this.getEffectiveCapabilitiesForConnection(connectionId);
    if (capabilities) {
      if (capabilities.supportsDelete) { contextParts.push('deletable'); }
      if (capabilities.supportsTruncate) { contextParts.push('truncatable'); }
      if (capabilities.supportsDDL) { contextParts.push('droppable'); }
      if (capabilities.supportsExport) { contextParts.push('exportable'); }
      if (capabilities.supportsRowEditing) { contextParts.push('editable'); }
    }
    item.contextValue = contextParts.join('-');

    item.iconPath = new vscode.ThemeIcon('table');
    item.command = {
      command: 'database-explorer.itemClick',
      title: 'Select',
      arguments: [item]
    };

    return item;
  }

  private createViewNode(connectionId: string, view: ViewInfo, schema: string): ExplorerTreeItem {
    const nodeData: TreeNodeData = {
      type: 'view',
      connectionId,
      label: view.name,
      schema,
      table: view.name
    };

    const item = new ExplorerTreeItem(
      view.name,
      vscode.TreeItemCollapsibleState.Collapsed,
      nodeData
    );

    // Build context value with capability flags
    const contextParts = ['view'];
    const capabilities = this.getEffectiveCapabilitiesForConnection(connectionId);
    if (capabilities) {
      if (capabilities.supportsDDL) { contextParts.push('droppable'); }
      if (capabilities.supportsExport) { contextParts.push('exportable'); }
    }
    item.contextValue = contextParts.join('-');

    item.iconPath = new vscode.ThemeIcon('eye');
    item.command = {
      command: 'database-explorer.itemClick',
      title: 'Select',
      arguments: [item]
    };

    return item;
  }

  private async getColumnNodes(connectionId: string, table: string, schema?: string, category?: 'tables' | 'views'): Promise<ExplorerTreeItem[]> {
    const driver = this.driverRegistry.getDriver(connectionId);
    if (!driver) {
      return [];
    }

    try {
      const columns = await driver.getColumns(table, schema);
      return columns.map(column => this.createColumnNode(connectionId, column, table, schema, category));
    } catch (error) {
      console.error('Error fetching columns:', error);
      return [];
    }
  }

  /**
   * Get the effective capabilities for a connection, considering read-only mode
   */
  private getEffectiveCapabilitiesForConnection(connectionId: string): DriverCapabilities | undefined {
    const connection = this.connectionStore.getConnectionSync(connectionId);
    if (!connection) {
      return undefined;
    }

    const capabilities = this.driverRegistry.getDriverCapabilities(connection.type);
    if (!capabilities) {
      return undefined;
    }

    return getEffectiveCapabilities(capabilities, connection.readOnly);
  }

  private createColumnNode(connectionId: string, column: ColumnInfo, table: string, schema?: string, category?: 'tables' | 'views'): ExplorerTreeItem {
    const nodeData: TreeNodeData = {
      type: 'column',
      connectionId,
      label: column.name,
      schema,
      category,
      table,
      columnInfo: column
    };

    const description = `${column.dataType}${column.nullable ? '' : ' NOT NULL'}${column.isPrimaryKey ? ' PK' : ''}`;

    const item = new ExplorerTreeItem(
      column.name,
      vscode.TreeItemCollapsibleState.None,
      nodeData
    );

    item.description = description;
    item.contextValue = 'column';
    item.iconPath = new vscode.ThemeIcon(column.isPrimaryKey ? 'key' : 'symbol-field');

    return item;
  }
}

export class ExplorerTreeItem extends vscode.TreeItem {
  constructor(
    public override readonly label: string,
    public override readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly nodeData: TreeNodeData
  ) {
    super(label, collapsibleState);
  }
}
