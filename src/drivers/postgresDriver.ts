import { Pool } from 'pg';
import { DriverMetadata, SchemaInfo, TableInfo, ViewInfo, ColumnInfo, QueryResult, ConnectionConfig } from '../types';
import { BaseDbDriver } from './baseDriver';
import { SQL_FULL_CAPABILITIES } from './capabilities';
import { DriverFactory } from './driverFactory';

/**
 * PostgreSQL driver metadata
 */
export const postgresMetadata: DriverMetadata = {
  id: 'postgres',
  displayName: 'PostgreSQL',
  icon: '$(database)',
  category: 'relational',
  defaultPort: 5432,
  capabilities: SQL_FULL_CAPABILITIES,
  connectionFields: [
    { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'localhost', group: 'basic' },
    { key: 'port', label: 'Port', type: 'number', required: true, defaultValue: 5432, group: 'basic' },
    { key: 'database', label: 'Database', type: 'text', required: true, placeholder: 'postgres', group: 'basic' },
    { key: 'username', label: 'Username', type: 'text', required: true, placeholder: 'postgres', group: 'basic' },
    { key: 'password', label: 'Password', type: 'password', required: false, group: 'basic' },
    { key: 'readOnly', label: 'Read-only mode', type: 'checkbox', required: false, defaultValue: false, group: 'advanced' }
  ]
};

export class PostgresDriver extends BaseDbDriver {
  private pool: Pool | null = null;

  constructor(config: ConnectionConfig, password: string = '') {
    super(config, password);
  }

  getMetadata(): DriverMetadata {
    return postgresMetadata;
  }

  async connect(): Promise<void> {
    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database as string,
      user: this.config.username,
      password: this.password,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });

    // Test connection
    const client = await this.pool.connect();
    client.release();
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
      SELECT schema_name as name 
      FROM information_schema.schemata 
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      ORDER BY schema_name
    `);
    return result.rows.map(row => ({ name: row.name as string }));
  }

  override async getTables(schema?: string): Promise<TableInfo[]> {
    const schemaFilter = schema || 'public';
    const result = await this.executeQuery(`
      SELECT table_name as name, table_schema as schema
      FROM information_schema.tables 
      WHERE table_schema = $1 AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `, [schemaFilter]);
    return result.rows.map(row => ({ 
      name: row.name as string, 
      schema: row.schema as string 
    }));
  }

  override async getViews(schema?: string): Promise<ViewInfo[]> {
    const schemaFilter = schema || 'public';
    const result = await this.executeQuery(`
      SELECT table_name as name, table_schema as schema
      FROM information_schema.views
      WHERE table_schema = $1
      ORDER BY table_name
    `, [schemaFilter]);
    return result.rows.map(row => ({
      name: row.name as string,
      schema: row.schema as string
    }));
  }

  override async getDDL(table: string, schema?: string): Promise<string> {
    const schemaFilter = schema || 'public';
    const tableTypeResult = await this.executeQuery(`
      SELECT table_type
      FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = $2
    `, [schemaFilter, table]);

    if (tableTypeResult.rows.length === 0) {
      throw new Error(`Table or view not found: ${schemaFilter}.${table}`);
    }

    const tableType = String(tableTypeResult.rows[0].table_type);
    if (tableType === 'VIEW') {
      const viewDef = await this.executeQuery(`
        SELECT pg_get_viewdef($1::regclass, true) as definition
      `, [`${schemaFilter}.${table}`]);
      const definition = viewDef.rows[0]?.definition as string | undefined;
      if (!definition) {
        throw new Error('Unable to fetch view definition');
      }
      return `CREATE VIEW ${schemaFilter}.${table} AS\n${definition};`;
    }

    const columns = await this.executeQuery(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `, [schemaFilter, table]);

    const pkColumns = await this.getPrimaryKeys(table, schemaFilter);
    const columnLines = columns.rows.map(row => {
      const name = row.column_name as string;
      const dataType = row.data_type as string;
      const nullable = row.is_nullable === 'YES' ? '' : ' NOT NULL';
      const defaultValue = row.column_default ? ` DEFAULT ${row.column_default}` : '';
      return `  ${name} ${dataType}${defaultValue}${nullable}`;
    });

    if (pkColumns.length > 0) {
      columnLines.push(`  PRIMARY KEY (${pkColumns.join(', ')})`);
    }

    return `CREATE TABLE ${schemaFilter}.${table} (\n${columnLines.join(',\n')}\n);`;
  }

  override async getColumns(table: string, schema?: string): Promise<ColumnInfo[]> {
    const schemaFilter = schema || 'public';
    const result = await this.executeQuery(`
      SELECT 
        c.column_name as name,
        c.data_type as "dataType",
        c.is_nullable = 'YES' as nullable,
        c.column_default as "defaultValue",
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as "isPrimaryKey"
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_name = $1
          AND tc.table_schema = $2
      ) pk ON c.column_name = pk.column_name
      WHERE c.table_name = $1 AND c.table_schema = $2
      ORDER BY c.ordinal_position
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

    const result = await this.pool.query(sql, params);
    
    return {
      columns: result.fields?.map(f => f.name) || [],
      rows: result.rows || [],
      rowCount: result.rowCount || 0,
      affectedRows: result.rowCount || undefined
    };
  }

  override async getPrimaryKeys(table: string, schema?: string): Promise<string[]> {
    const schemaFilter = schema || 'public';
    const result = await this.executeQuery(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_name = $1
        AND tc.table_schema = $2
      ORDER BY kcu.ordinal_position
    `, [table, schemaFilter]);
    
    return result.rows.map(row => row.column_name as string);
  }

  override async insertRow(table: string, data: Record<string, unknown>, schema?: string): Promise<QueryResult> {
    this.assertWriteAllowed();
    const schemaFilter = schema || 'public';
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map((_, i) => `$${i + 1}`);
    
    const sql = `
      INSERT INTO "${schemaFilter}"."${table}" (${columns.map(c => `"${c}"`).join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `;
    
    return this.executeQuery(sql, values);
  }

  override async updateRow(
    table: string, 
    primaryKeyValues: Record<string, unknown>, 
    data: Record<string, unknown>, 
    schema?: string
  ): Promise<QueryResult> {
    this.assertWriteAllowed();
    const schemaFilter = schema || 'public';
    const setClauses: string[] = [];
    const whereClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [col, val] of Object.entries(data)) {
      setClauses.push(`"${col}" = $${paramIndex}`);
      values.push(val);
      paramIndex++;
    }

    for (const [col, val] of Object.entries(primaryKeyValues)) {
      whereClauses.push(`"${col}" = $${paramIndex}`);
      values.push(val);
      paramIndex++;
    }

    const sql = `
      UPDATE "${schemaFilter}"."${table}"
      SET ${setClauses.join(', ')}
      WHERE ${whereClauses.join(' AND ')}
      RETURNING *
    `;

    return this.executeQuery(sql, values);
  }

  override async deleteRow(table: string, primaryKeyValues: Record<string, unknown>, schema?: string): Promise<QueryResult> {
    this.assertWriteAllowed();
    const schemaFilter = schema || 'public';
    const whereClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [col, val] of Object.entries(primaryKeyValues)) {
      whereClauses.push(`"${col}" = $${paramIndex}`);
      values.push(val);
      paramIndex++;
    }

    const sql = `
      DELETE FROM "${schemaFilter}"."${table}"
      WHERE ${whereClauses.join(' AND ')}
      RETURNING *
    `;

    return this.executeQuery(sql, values);
  }
}

// Register the driver with the factory
DriverFactory.register(postgresMetadata, PostgresDriver);
