import initSqlJs, { Database } from 'sql.js';
import * as fs from 'fs';
import { DriverMetadata, SchemaInfo, TableInfo, ViewInfo, ColumnInfo, QueryResult, ConnectionConfig } from '../types';
import { BaseDbDriver } from './baseDriver';
import { SQLITE_CAPABILITIES } from './capabilities';
import { DriverFactory } from './driverFactory';

/**
 * SQLite driver metadata
 */
export const sqliteMetadata: DriverMetadata = {
  id: 'sqlite',
  displayName: 'SQLite',
  icon: '$(file-binary)',
  category: 'relational',
  capabilities: SQLITE_CAPABILITIES,
  connectionFields: [
    { key: 'filepath', label: 'Database File', type: 'file', required: true, placeholder: '/path/to/database.db', group: 'basic' },
    { key: 'readOnly', label: 'Read-only mode', type: 'checkbox', required: false, defaultValue: false, group: 'advanced' }
  ]
};

export class SqliteDriver extends BaseDbDriver {
  private db: Database | null = null;
  private filepath: string;

  constructor(config: ConnectionConfig, password: string = '') {
    super(config, password);
    this.filepath = config.filepath || (config.database as string);
  }

  getMetadata(): DriverMetadata {
    return sqliteMetadata;
  }

  async connect(): Promise<void> {
    const SQL = await initSqlJs();
    
    try {
      // Try to read existing database file
      const buffer = fs.readFileSync(this.filepath);
      this.db = new SQL.Database(buffer);
    } catch {
      // Create new database if file doesn't exist
      this.db = new SQL.Database();
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      // Only save to file if not in read-only mode
      if (!this.config.readOnly) {
        const data = this.db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(this.filepath, buffer);
      }
      
      this.db.close();
      this.db = null;
    }
    this.connected = false;
  }

  override isConnected(): boolean {
    return this.connected && this.db !== null;
  }

  override async getSchemas(): Promise<SchemaInfo[]> {
    // SQLite doesn't have schemas in the same sense, return 'main'
    return [{ name: 'main' }];
  }

  override async getTables(schema?: string): Promise<TableInfo[]> {
    const result = await this.executeQuery(`
      SELECT name 
      FROM sqlite_master 
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);
    return result.rows.map(row => ({ 
      name: row.name as string,
      schema: 'main'
    }));
  }

  override async getViews(schema?: string): Promise<ViewInfo[]> {
    const result = await this.executeQuery(`
      SELECT name 
      FROM sqlite_master 
      WHERE type = 'view' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);
    return result.rows.map(row => ({
      name: row.name as string,
      schema: 'main'
    }));
  }

  override async getDDL(table: string, schema?: string): Promise<string> {
    const result = await this.executeQuery(
      `SELECT sql FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')`,
      [table]
    );
    const sql = result.rows[0]?.sql as string | undefined;
    if (!sql) {
      throw new Error(`Table or view not found: ${table}`);
    }
    return sql.trim().endsWith(';') ? sql.trim() : `${sql.trim()};`;
  }

  override async getColumns(table: string, schema?: string): Promise<ColumnInfo[]> {
    const result = await this.executeQuery(`PRAGMA table_info("${table}")`);
    
    return result.rows.map(row => ({
      name: row.name as string,
      dataType: (row.type as string) || 'TEXT',
      nullable: (row.notnull as number) === 0,
      isPrimaryKey: (row.pk as number) > 0,
      defaultValue: row.dflt_value as string | undefined
    }));
  }

  override async executeQuery(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    // Validate query respects read-only mode
    this.validateQuery(sql);

    const trimmedSql = sql.trim().toLowerCase();
    const isSelect = trimmedSql.startsWith('select') || trimmedSql.startsWith('pragma');

    if (isSelect) {
      const stmt = this.db.prepare(sql);
      if (params) {
        stmt.bind(params as (string | number | Uint8Array | null)[]);
      }
      
      const rows: Record<string, unknown>[] = [];
      const columns: string[] = stmt.getColumnNames();
      
      while (stmt.step()) {
        const rowData = stmt.getAsObject();
        rows.push(rowData as Record<string, unknown>);
      }
      stmt.free();
      
      return {
        columns,
        rows,
        rowCount: rows.length
      };
    } else {
      this.db.run(sql, params as (string | number | Uint8Array | null)[] | undefined);
      const changes = this.db.getRowsModified();
      
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: changes
      };
    }
  }

  override async getPrimaryKeys(table: string, schema?: string): Promise<string[]> {
    const result = await this.executeQuery(`PRAGMA table_info("${table}")`);
    return result.rows
      .filter(row => (row.pk as number) > 0)
      .map(row => row.name as string);
  }

  override async insertRow(table: string, data: Record<string, unknown>, schema?: string): Promise<QueryResult> {
    this.assertWriteAllowed();
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map(() => '?');
    
    const sql = `
      INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')})
      VALUES (${placeholders.join(', ')})
    `;
    
    const insertResult = await this.executeQuery(sql, values);
    
    // Fetch the inserted row using last_insert_rowid()
    const selectResult = await this.executeQuery(
      `SELECT * FROM "${table}" WHERE rowid = last_insert_rowid()`
    );
    
    return {
      ...insertResult,
      rows: selectResult.rows,
      columns: selectResult.columns
    };
  }

  override async updateRow(
    table: string, 
    primaryKeyValues: Record<string, unknown>, 
    data: Record<string, unknown>, 
    schema?: string
  ): Promise<QueryResult> {
    this.assertWriteAllowed();
    const setClauses: string[] = [];
    const whereClauses: string[] = [];
    const values: unknown[] = [];

    for (const [col, val] of Object.entries(data)) {
      setClauses.push(`"${col}" = ?`);
      values.push(val);
    }

    for (const [col, val] of Object.entries(primaryKeyValues)) {
      whereClauses.push(`"${col}" = ?`);
      values.push(val);
    }

    const sql = `
      UPDATE "${table}"
      SET ${setClauses.join(', ')}
      WHERE ${whereClauses.join(' AND ')}
    `;

    const updateResult = await this.executeQuery(sql, values);

    // Fetch the updated row
    const selectValues = Object.values(primaryKeyValues);
    const selectWhere = Object.keys(primaryKeyValues).map(c => `"${c}" = ?`).join(' AND ');
    const selectResult = await this.executeQuery(
      `SELECT * FROM "${table}" WHERE ${selectWhere}`,
      selectValues
    );

    return {
      ...updateResult,
      rows: selectResult.rows,
      columns: selectResult.columns
    };
  }

  override async deleteRow(table: string, primaryKeyValues: Record<string, unknown>, schema?: string): Promise<QueryResult> {
    this.assertWriteAllowed();
    const whereClauses: string[] = [];
    const values: unknown[] = [];

    for (const [col, val] of Object.entries(primaryKeyValues)) {
      whereClauses.push(`"${col}" = ?`);
      values.push(val);
    }

    const sql = `
      DELETE FROM "${table}"
      WHERE ${whereClauses.join(' AND ')}
    `;

    return this.executeQuery(sql, values);
  }
}

// Register the driver with the factory
DriverFactory.register(sqliteMetadata, SqliteDriver);
