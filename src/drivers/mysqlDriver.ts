import * as mysql from 'mysql2/promise';
import { DriverMetadata, SchemaInfo, TableInfo, ViewInfo, ColumnInfo, QueryResult, ConnectionConfig } from '../types';
import { BaseDbDriver } from './baseDriver';
import { MYSQL_CAPABILITIES } from './capabilities';
import { DriverFactory } from './driverFactory';

/**
 * MySQL driver metadata
 */
export const mysqlMetadata: DriverMetadata = {
  id: 'mysql',
  displayName: 'MySQL',
  icon: '$(database)',
  category: 'relational',
  defaultPort: 3306,
  capabilities: MYSQL_CAPABILITIES,
  connectionFields: [
    { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'localhost', group: 'basic' },
    { key: 'port', label: 'Port', type: 'number', required: true, defaultValue: 3306, group: 'basic' },
    { key: 'database', label: 'Database', type: 'text', required: true, placeholder: 'mysql', group: 'basic' },
    { key: 'username', label: 'Username', type: 'text', required: true, placeholder: 'root', group: 'basic' },
    { key: 'password', label: 'Password', type: 'password', required: false, group: 'basic' },
    { key: 'readOnly', label: 'Read-only mode', type: 'checkbox', required: false, defaultValue: false, group: 'advanced' }
  ]
};

export class MySqlDriver extends BaseDbDriver {
  private pool: mysql.Pool | null = null;

  constructor(config: ConnectionConfig, password: string = '') {
    super(config, password);
  }

  getMetadata(): DriverMetadata {
    return mysqlMetadata;
  }

  async connect(): Promise<void> {
    this.pool = mysql.createPool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database as string,
      user: this.config.username,
      password: this.password,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0
    });

    // Test connection
    const conn = await this.pool.getConnection();
    conn.release();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.connected = false;
  }

  override isConnected(): boolean {
    return this.connected && this.pool !== null;
  }

  override async getSchemas(): Promise<SchemaInfo[]> {
    const result = await this.executeQuery(`
      SELECT SCHEMA_NAME as name 
      FROM information_schema.SCHEMATA 
      WHERE SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
      ORDER BY SCHEMA_NAME
    `);
    return result.rows.map(row => ({ name: row.name as string }));
  }

  override async getTables(schema?: string): Promise<TableInfo[]> {
    const schemaFilter = schema || this.config.database;
    const result = await this.executeQuery(`
      SELECT TABLE_NAME as name, TABLE_SCHEMA as \`schema\`
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `, [schemaFilter]);
    return result.rows.map(row => ({ 
      name: row.name as string, 
      schema: row.schema as string 
    }));
  }

  override async getViews(schema?: string): Promise<ViewInfo[]> {
    const schemaFilter = schema || this.config.database;
    const result = await this.executeQuery(`
      SELECT TABLE_NAME as name, TABLE_SCHEMA as \`schema\`
      FROM information_schema.VIEWS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME
    `, [schemaFilter]);
    return result.rows.map(row => ({
      name: row.name as string,
      schema: row.schema as string
    }));
  }

  override async getDDL(table: string, schema?: string): Promise<string> {
    const schemaFilter = schema || this.config.database;
    const tableTypeResult = await this.executeQuery(`
      SELECT TABLE_TYPE as table_type
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    `, [schemaFilter, table]);

    if (tableTypeResult.rows.length === 0) {
      throw new Error(`Table or view not found: ${schemaFilter}.${table}`);
    }

    const tableType = String(tableTypeResult.rows[0].table_type);
    const ddlSql = tableType === 'VIEW'
      ? `SHOW CREATE VIEW \`${schemaFilter}\`.\`${table}\``
      : `SHOW CREATE TABLE \`${schemaFilter}\`.\`${table}\``;

    const ddlResult = await this.executeQuery(ddlSql);
    const row = ddlResult.rows[0] as Record<string, unknown>;
    const ddlKey = Object.keys(row).find(key => key.toLowerCase().includes('create'));
    const ddl = ddlKey ? row[ddlKey] : undefined;
    if (!ddl) {
      throw new Error(`Unable to fetch ${tableType.toLowerCase()} DDL`);
    }
    return String(ddl);
  }

  override async getColumns(table: string, schema?: string): Promise<ColumnInfo[]> {
    const schemaFilter = schema || this.config.database;
    const result = await this.executeQuery(`
      SELECT 
        c.COLUMN_NAME as name,
        c.DATA_TYPE as dataType,
        c.IS_NULLABLE = 'YES' as nullable,
        c.COLUMN_DEFAULT as defaultValue,
        c.COLUMN_KEY = 'PRI' as isPrimaryKey
      FROM information_schema.COLUMNS c
      WHERE c.TABLE_NAME = ? AND c.TABLE_SCHEMA = ?
      ORDER BY c.ORDINAL_POSITION
    `, [table, schemaFilter]);
    
    return result.rows.map(row => ({
      name: row.name as string,
      dataType: row.dataType as string,
      nullable: Boolean(row.nullable),
      isPrimaryKey: Boolean(row.isPrimaryKey),
      defaultValue: row.defaultValue as string | undefined
    }));
  }

  override async executeQuery(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    // Validate query respects read-only mode
    this.validateQuery(sql);

    const [rows, fields] = await this.pool.query(sql, params);
    
    // Handle different result types
    if (Array.isArray(rows)) {
      const resultRows = rows as Record<string, unknown>[];
      const fieldDefs = fields as mysql.FieldPacket[] | undefined;
      return {
        columns: fieldDefs?.map(f => f.name) || [],
        rows: resultRows,
        rowCount: resultRows.length
      };
    } else {
      // For INSERT, UPDATE, DELETE
      const result = rows as mysql.ResultSetHeader;
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: result.affectedRows
      };
    }
  }

  override async getPrimaryKeys(table: string, schema?: string): Promise<string[]> {
    const schemaFilter = schema || this.config.database;
    const result = await this.executeQuery(`
      SELECT COLUMN_NAME as column_name
      FROM information_schema.COLUMNS
      WHERE TABLE_NAME = ? AND TABLE_SCHEMA = ? AND COLUMN_KEY = 'PRI'
      ORDER BY ORDINAL_POSITION
    `, [table, schemaFilter]);
    
    return result.rows.map(row => row.column_name as string);
  }

  override async insertRow(table: string, data: Record<string, unknown>, schema?: string): Promise<QueryResult> {
    this.assertWriteAllowed();
    const schemaFilter = schema || this.config.database;
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map(() => '?');
    
    const sql = `
      INSERT INTO \`${schemaFilter}\`.\`${table}\` (${columns.map(c => `\`${c}\``).join(', ')})
      VALUES (${placeholders.join(', ')})
    `;
    
    const insertResult = await this.executeQuery(sql, values);
    
    // Fetch the inserted row
    const selectResult = await this.executeQuery(
      `SELECT * FROM \`${schemaFilter}\`.\`${table}\` WHERE LAST_INSERT_ID() > 0 ORDER BY LAST_INSERT_ID() DESC LIMIT 1`
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
    const schemaFilter = schema || this.config.database;
    const setClauses: string[] = [];
    const whereClauses: string[] = [];
    const values: unknown[] = [];

    for (const [col, val] of Object.entries(data)) {
      setClauses.push(`\`${col}\` = ?`);
      values.push(val);
    }

    for (const [col, val] of Object.entries(primaryKeyValues)) {
      whereClauses.push(`\`${col}\` = ?`);
      values.push(val);
    }

    const sql = `
      UPDATE \`${schemaFilter}\`.\`${table}\`
      SET ${setClauses.join(', ')}
      WHERE ${whereClauses.join(' AND ')}
    `;

    const updateResult = await this.executeQuery(sql, values);

    // Fetch the updated row
    const selectValues = Object.values(primaryKeyValues);
    const selectWhere = Object.keys(primaryKeyValues).map(c => `\`${c}\` = ?`).join(' AND ');
    const selectResult = await this.executeQuery(
      `SELECT * FROM \`${schemaFilter}\`.\`${table}\` WHERE ${selectWhere}`,
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
    const schemaFilter = schema || this.config.database;
    const whereClauses: string[] = [];
    const values: unknown[] = [];

    for (const [col, val] of Object.entries(primaryKeyValues)) {
      whereClauses.push(`\`${col}\` = ?`);
      values.push(val);
    }

    const sql = `
      DELETE FROM \`${schemaFilter}\`.\`${table}\`
      WHERE ${whereClauses.join(' AND ')}
    `;

    return this.executeQuery(sql, values);
  }
}

// Register the driver with the factory
DriverFactory.register(mysqlMetadata, MySqlDriver);
