// ============================================================================
// Driver Metadata & Registration
// ============================================================================

export type DatabaseCategory = 
  | 'relational' 
  | 'document' 
  | 'keyvalue' 
  | 'columnar' 
  | 'graph' 
  | 'warehouse' 
  | 'timeseries';

export type TreeStructureType = 
  | 'schema-table-column'      // PostgreSQL, MySQL, MSSQL, Oracle
  | 'database-table-column'    // SQLite (no schemas)
  | 'database-collection'      // MongoDB, DynamoDB
  | 'bucket-measurement'       // InfluxDB
  | 'metric-label'             // Prometheus
  | 'keyspace';                // Redis

export interface ConnectionField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'file' | 'select' | 'checkbox';
  required: boolean;
  placeholder?: string;
  defaultValue?: string | number | boolean;
  options?: { value: string; label: string }[];
  group?: 'basic' | 'advanced' | 'ssh' | 'replica';
}

export interface DriverCapabilities {
  // Data Structure
  supportsSchemas: boolean;
  supportsTables: boolean;
  supportsViews: boolean;
  supportsCollections: boolean;
  supportsMeasurements: boolean;
  
  // Query Capabilities
  supportsSQL: boolean;
  supportsNoSQLQueries: boolean;
  supportsFlux: boolean;
  supportsPromQL: boolean;
  
  // CRUD Operations
  supportsInsert: boolean;
  supportsUpdate: boolean;
  supportsDelete: boolean;
  supportsTruncate: boolean;
  supportsDDL: boolean;
  
  // Advanced Features
  supportsTransactions: boolean;
  supportsPrimaryKeys: boolean;
  supportsExport: boolean;
  supportsRowEditing: boolean;
  
  // Tree View Structure
  treeStructure: TreeStructureType;
}

export interface DriverMetadata {
  id: string;
  displayName: string;
  icon: string;
  category: DatabaseCategory;
  connectionFields: ConnectionField[];
  defaultPort?: number;
  capabilities: DriverCapabilities;
}

// ============================================================================
// Connection Configuration
// ============================================================================

export interface ReadReplicaHost {
  host: string;
  port: number;
  weight?: number;
}

export interface ReplicaConfig {
  enabled: boolean;
  writeHost: string;
  writePort: number;
  readHosts: ReadReplicaHost[];
  loadBalancing: 'round-robin' | 'random' | 'first-available';
}

export interface ProxyConfig {
  type: 'ssh' | 'socks5' | 'http';
  
  // SSH Tunnel
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshAuthMethod?: 'password' | 'privateKey' | 'agent';
  sshPrivateKeyPath?: string;
  // sshPassword stored in SecretStorage
  
  // SOCKS5/HTTP Proxy
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  // proxyPassword stored in SecretStorage
}

export interface ConnectionConfig {
  id: string;
  name: string;
  type: string;  // Driver ID (no longer a union type)
  
  // Common connection fields
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  // password stored in SecretStorage, not here
  
  // SQLite specific
  filepath?: string;
  
  // Connection Mode
  readOnly?: boolean;
  
  // Read/Write Replica Configuration
  replicaConfig?: ReplicaConfig;
  
  // Proxy/Tunnel Configuration
  proxyConfig?: ProxyConfig;
  
  // Driver-specific options (extensible)
  [key: string]: unknown;
}

// Legacy type alias for backward compatibility
export type DatabaseType = 'postgres' | 'mysql' | 'sqlite';

export interface SchemaInfo {
  name: string;
}

export interface TableInfo {
  name: string;
  schema?: string;
}

export interface ViewInfo {
  name: string;
  schema?: string;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  defaultValue?: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  affectedRows?: number;
}

// ============================================================================
// NoSQL Types
// ============================================================================

export interface CollectionInfo {
  name: string;
  database?: string;
}

export interface DocumentResult {
  documents: Record<string, unknown>[];
  count: number;
}

// ============================================================================
// Time-Series Types
// ============================================================================

export interface MeasurementInfo {
  name: string;
  retentionPolicy?: string;
}

export interface FieldInfo {
  name: string;
  type: string;
}

export interface TagInfo {
  name: string;
  values?: string[];
}

export interface TimeSeriesQuery {
  measurement: string;
  start: Date;
  end: Date;
  aggregation?: 'mean' | 'sum' | 'count' | 'min' | 'max';
  interval?: string;
}

export interface TimeSeriesResult {
  timestamps: Date[];
  series: { name: string; values: number[] }[];
}

// ============================================================================
// Status Bar Types
// ============================================================================

export interface LastViewedTable {
  connectionId: string;
  connectionName: string;
  schema?: string;
  table: string;
  query: string;
  timestamp: number;
}

// ============================================================================
// Driver Interface
// ============================================================================

export interface DbDriver {
  // Core methods
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  // Get driver metadata and capabilities
  getMetadata(): DriverMetadata;
  
  // SQL database methods
  getSchemas(): Promise<SchemaInfo[]>;
  getTables(schema?: string): Promise<TableInfo[]>;
  getViews(schema?: string): Promise<ViewInfo[]>;
  getDDL(table: string, schema?: string): Promise<string>;
  getColumns(table: string, schema?: string): Promise<ColumnInfo[]>;
  executeQuery(sql: string, params?: unknown[]): Promise<QueryResult>;
  getPrimaryKeys(table: string, schema?: string): Promise<string[]>;
  insertRow(table: string, data: Record<string, unknown>, schema?: string): Promise<QueryResult>;
  updateRow(table: string, primaryKeyValues: Record<string, unknown>, data: Record<string, unknown>, schema?: string): Promise<QueryResult>;
  deleteRow(table: string, primaryKeyValues: Record<string, unknown>, schema?: string): Promise<QueryResult>;
  
  // NoSQL extensions (optional)
  getCollections?(): Promise<CollectionInfo[]>;
  getDocuments?(collection: string, filter?: Record<string, unknown>): Promise<DocumentResult>;
  insertDocument?(collection: string, doc: Record<string, unknown>): Promise<void>;
  updateDocument?(collection: string, filter: Record<string, unknown>, update: Record<string, unknown>): Promise<void>;
  deleteDocument?(collection: string, filter: Record<string, unknown>): Promise<void>;
  
  // Time-series extensions (optional)
  getMeasurements?(): Promise<MeasurementInfo[]>;
  getFields?(measurement: string): Promise<FieldInfo[]>;
  getTags?(measurement: string): Promise<TagInfo[]>;
  queryTimeRange?(query: TimeSeriesQuery): Promise<TimeSeriesResult>;
}

export interface TreeNodeData {
  type: 'connection' | 'schema' | 'category' | 'table' | 'view' | 'column';
  connectionId: string;
  label: string;
  schema?: string;
  category?: 'tables' | 'views';
  table?: string;
  columnInfo?: ColumnInfo;
  isConnected?: boolean;
}
