import {
  DbDriver,
  DriverMetadata,
  ConnectionConfig,
  SchemaInfo,
  TableInfo,
  ViewInfo,
  ColumnInfo,
  QueryResult,
  CollectionInfo,
  DocumentResult,
  MeasurementInfo,
  FieldInfo,
  TagInfo,
  TimeSeriesQuery,
  TimeSeriesResult
} from '../types';

/**
 * Abstract base class for all database drivers.
 * Provides common functionality including:
 * - Read-only mode enforcement
 * - Default implementations for optional methods
 * - Connection state management
 */
export abstract class BaseDbDriver implements DbDriver {
  protected config: ConnectionConfig;
  protected password: string;
  protected connected = false;

  constructor(config: ConnectionConfig, password: string = '') {
    this.config = config;
    this.password = password;
  }

  // ============================================================================
  // Abstract methods that must be implemented by each driver
  // ============================================================================

  abstract getMetadata(): DriverMetadata;
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  // ============================================================================
  // Connection state
  // ============================================================================

  isConnected(): boolean {
    return this.connected;
  }

  // ============================================================================
  // Read-only mode enforcement
  // ============================================================================

  /**
   * Check if write operations are allowed
   * Throws an error if the connection is in read-only mode
   */
  protected assertWriteAllowed(): void {
    if (this.config.readOnly) {
      throw new Error('Connection is in read-only mode. Write operations are not allowed.');
    }
  }

  /**
   * Check if a SQL query is a write operation
   */
  protected isWriteQuery(sql: string): boolean {
    const normalized = sql.trim().toLowerCase();
    return /^(insert|update|delete|drop|alter|create|truncate|grant|revoke)/i.test(normalized);
  }

  /**
   * Validate a query respects read-only mode
   */
  protected validateQuery(sql: string): void {
    if (this.config.readOnly && this.isWriteQuery(sql)) {
      throw new Error('Write queries are not allowed in read-only mode.');
    }
  }

  // ============================================================================
  // SQL database methods - default implementations that throw "not supported"
  // Drivers should override these as needed based on their capabilities
  // ============================================================================

  async getSchemas(): Promise<SchemaInfo[]> {
    throw new Error('Schemas are not supported by this driver.');
  }

  async getTables(schema?: string): Promise<TableInfo[]> {
    throw new Error('Tables are not supported by this driver.');
  }

  async getViews(schema?: string): Promise<ViewInfo[]> {
    throw new Error('Views are not supported by this driver.');
  }

  async getDDL(table: string, schema?: string): Promise<string> {
    throw new Error('DDL generation is not supported by this driver.');
  }

  async getColumns(table: string, schema?: string): Promise<ColumnInfo[]> {
    throw new Error('Column introspection is not supported by this driver.');
  }

  async executeQuery(sql: string, params?: unknown[]): Promise<QueryResult> {
    throw new Error('SQL queries are not supported by this driver.');
  }

  async getPrimaryKeys(table: string, schema?: string): Promise<string[]> {
    throw new Error('Primary key introspection is not supported by this driver.');
  }

  async insertRow(table: string, data: Record<string, unknown>, schema?: string): Promise<QueryResult> {
    this.assertWriteAllowed();
    throw new Error('Row insertion is not supported by this driver.');
  }

  async updateRow(
    table: string,
    primaryKeyValues: Record<string, unknown>,
    data: Record<string, unknown>,
    schema?: string
  ): Promise<QueryResult> {
    this.assertWriteAllowed();
    throw new Error('Row updates are not supported by this driver.');
  }

  async deleteRow(table: string, primaryKeyValues: Record<string, unknown>, schema?: string): Promise<QueryResult> {
    this.assertWriteAllowed();
    throw new Error('Row deletion is not supported by this driver.');
  }

  // ============================================================================
  // NoSQL methods - optional, default to undefined (not implemented)
  // ============================================================================

  async getCollections(): Promise<CollectionInfo[]> {
    throw new Error('Collections are not supported by this driver.');
  }

  async getDocuments(collection: string, filter?: Record<string, unknown>): Promise<DocumentResult> {
    throw new Error('Document queries are not supported by this driver.');
  }

  async insertDocument(collection: string, doc: Record<string, unknown>): Promise<void> {
    this.assertWriteAllowed();
    throw new Error('Document insertion is not supported by this driver.');
  }

  async updateDocument(collection: string, filter: Record<string, unknown>, update: Record<string, unknown>): Promise<void> {
    this.assertWriteAllowed();
    throw new Error('Document updates are not supported by this driver.');
  }

  async deleteDocument(collection: string, filter: Record<string, unknown>): Promise<void> {
    this.assertWriteAllowed();
    throw new Error('Document deletion is not supported by this driver.');
  }

  // ============================================================================
  // Time-series methods - optional, default to undefined (not implemented)
  // ============================================================================

  async getMeasurements(): Promise<MeasurementInfo[]> {
    throw new Error('Measurements are not supported by this driver.');
  }

  async getFields(measurement: string): Promise<FieldInfo[]> {
    throw new Error('Field introspection is not supported by this driver.');
  }

  async getTags(measurement: string): Promise<TagInfo[]> {
    throw new Error('Tag introspection is not supported by this driver.');
  }

  async queryTimeRange(query: TimeSeriesQuery): Promise<TimeSeriesResult> {
    throw new Error('Time-range queries are not supported by this driver.');
  }
}
