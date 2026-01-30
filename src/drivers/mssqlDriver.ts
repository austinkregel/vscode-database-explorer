import * as sql from 'mssql';
import { DriverMetadata, SchemaInfo, TableInfo, ViewInfo, ColumnInfo, QueryResult, ConnectionConfig } from '../types';
import { BaseDbDriver } from './baseDriver';
import { SQL_FULL_CAPABILITIES } from './capabilities';
import { DriverFactory } from './driverFactory';

/**
 * Microsoft SQL Server driver metadata
 */
export const mssqlMetadata: DriverMetadata = {
  id: 'mssql',
  displayName: 'Microsoft SQL Server',
  icon: '$(database)',
  category: 'relational',
  defaultPort: 1433,
  capabilities: {
    ...SQL_FULL_CAPABILITIES,
    treeStructure: 'schema-table-column'
  },
  connectionFields: [
    { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'localhost', group: 'basic' },
    { key: 'port', label: 'Port', type: 'number', required: true, defaultValue: 1433, group: 'basic' },
    { key: 'database', label: 'Database', type: 'text', required: true, placeholder: 'master', group: 'basic' },
    { key: 'username', label: 'Username', type: 'text', required: true, placeholder: 'sa', group: 'basic' },
    { key: 'password', label: 'Password', type: 'password', required: false, group: 'basic' },
    { key: 'encrypt', label: 'Encrypt Connection', type: 'checkbox', required: false, defaultValue: true, group: 'advanced' },
    { key: 'trustServerCertificate', label: 'Trust Server Certificate', type: 'checkbox', required: false, defaultValue: false, group: 'advanced' },
    { key: 'readOnly', label: 'Read-only mode', type: 'checkbox', required: false, defaultValue: false, group: 'advanced' }
  ]
};

export class MssqlDriver extends BaseDbDriver {
  private pool: sql.ConnectionPool | null = null;

  constructor(config: ConnectionConfig, password: string = '') {
    super(config, password);
  }

  getMetadata(): DriverMetadata {
    return mssqlMetadata;
  }

  async connect(): Promise<void> {
    const sqlConfig: sql.config = {
      server: this.config.host || 'localhost',
      port: this.config.port || 1433,
      database: this.config.database as string,
      user: this.config.username,
      password: this.password,
      options: {
        encrypt: this.config.encrypt !== false,
        trustServerCertificate: this.config.trustServerCertificate === true
      },
      pool: {
        max: 5,
        min: 0,
        idleTimeoutMillis: 30000
      }
    };

    this.pool = await sql.connect(sqlConfig);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
    this.connected = false;
  }

  override isConnected(): boolean {
    return this.connected && this.pool !== null && this.pool.connected;
  }

  override async getSchemas(): Promise<SchemaInfo[]> {
    const result = await this.executeQuery(`
      SELECT SCHEMA_NAME as name 
      FROM INFORMATION_SCHEMA.SCHEMATA 
      WHERE SCHEMA_NAME NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest')
      ORDER BY SCHEMA_NAME
    `);
    return result.rows.map(row => ({ name: row.name as string }));
  }

  override async getTables(schema?: string): Promise<TableInfo[]> {
    const schemaFilter = schema || 'dbo';
    const result = await this.executeQuery(`
      SELECT TABLE_NAME as name, TABLE_SCHEMA as [schema]
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = @schema AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `, [schemaFilter]);
    return result.rows.map(row => ({ 
      name: row.name as string, 
      schema: row.schema as string 
    }));
  }

  override async getViews(schema?: string): Promise<ViewInfo[]> {
    const schemaFilter = schema || 'dbo';
    const result = await this.executeQuery(`
      SELECT TABLE_NAME as name, TABLE_SCHEMA as [schema]
      FROM INFORMATION_SCHEMA.VIEWS
      WHERE TABLE_SCHEMA = @schema
      ORDER BY TABLE_NAME
    `, [schemaFilter]);
    return result.rows.map(row => ({
      name: row.name as string,
      schema: row.schema as string
    }));
  }

  override async getDDL(table: string, schema?: string): Promise<string> {
    const schemaFilter = schema || 'dbo';
    
    // Check if it's a table or view
    const typeResult = await this.executeQuery(`
      SELECT TABLE_TYPE as table_type
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
    `, [schemaFilter, table]);

    if (typeResult.rows.length === 0) {
      throw new Error(`Table or view not found: ${schemaFilter}.${table}`);
    }

    const tableType = String(typeResult.rows[0].table_type);
    
    if (tableType === 'VIEW') {
      const viewDef = await this.executeQuery(`
        SELECT definition
        FROM sys.sql_modules
        WHERE object_id = OBJECT_ID(@objectName)
      `, [`${schemaFilter}.${table}`]);
      
      const definition = viewDef.rows[0]?.definition as string | undefined;
      if (!definition) {
        throw new Error('Unable to fetch view definition');
      }
      return definition;
    }

    // Generate table DDL
    const columns = await this.executeQuery(`
      SELECT 
        COLUMN_NAME as column_name,
        DATA_TYPE as data_type,
        CHARACTER_MAXIMUM_LENGTH as max_length,
        IS_NULLABLE as is_nullable,
        COLUMN_DEFAULT as column_default
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
      ORDER BY ORDINAL_POSITION
    `, [schemaFilter, table]);

    const pkColumns = await this.getPrimaryKeys(table, schemaFilter);
    
    const columnLines = columns.rows.map(row => {
      const name = row.column_name as string;
      let dataType = row.data_type as string;
      const maxLength = row.max_length as number | null;
      const nullable = row.is_nullable === 'YES' ? '' : ' NOT NULL';
      const defaultValue = row.column_default ? ` DEFAULT ${row.column_default}` : '';
      
      if (maxLength && maxLength > 0) {
        dataType += `(${maxLength})`;
      }
      
      return `  [${name}] ${dataType}${defaultValue}${nullable}`;
    });

    if (pkColumns.length > 0) {
      columnLines.push(`  PRIMARY KEY (${pkColumns.map(c => `[${c}]`).join(', ')})`);
    }

    return `CREATE TABLE [${schemaFilter}].[${table}] (\n${columnLines.join(',\n')}\n);`;
  }

  override async getColumns(table: string, schema?: string): Promise<ColumnInfo[]> {
    const schemaFilter = schema || 'dbo';
    const result = await this.executeQuery(`
      SELECT 
        c.COLUMN_NAME as name,
        c.DATA_TYPE as dataType,
        CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END as nullable,
        c.COLUMN_DEFAULT as defaultValue,
        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as isPrimaryKey
      FROM INFORMATION_SCHEMA.COLUMNS c
      LEFT JOIN (
        SELECT ku.COLUMN_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
          ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
          AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
          AND tc.TABLE_NAME = @table
          AND tc.TABLE_SCHEMA = @schema
      ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
      WHERE c.TABLE_NAME = @table AND c.TABLE_SCHEMA = @schema
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

  override async executeQuery(sqlQuery: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    // Validate query respects read-only mode
    this.validateQuery(sqlQuery);

    const request = this.pool.request();
    
    // Bind parameters - MSSQL uses named parameters
    if (params) {
      params.forEach((param, index) => {
        request.input(`param${index}`, param);
      });
      
      // Replace @schema, @table, @objectName style params with positional
      let modifiedSql = sqlQuery;
      const namedParams = sqlQuery.match(/@\w+/g);
      if (namedParams) {
        const uniqueParams = [...new Set(namedParams)];
        uniqueParams.forEach((namedParam, index) => {
          if (index < params.length) {
            modifiedSql = modifiedSql.replace(new RegExp(namedParam, 'g'), `@param${index}`);
          }
        });
      }
      
      const result = await request.query(modifiedSql);
      return {
        columns: result.recordset?.columns ? Object.keys(result.recordset.columns) : [],
        rows: result.recordset || [],
        rowCount: result.recordset?.length || 0,
        affectedRows: result.rowsAffected?.[0] || undefined
      };
    }

    const result = await request.query(sqlQuery);
    return {
      columns: result.recordset?.columns ? Object.keys(result.recordset.columns) : [],
      rows: result.recordset || [],
      rowCount: result.recordset?.length || 0,
      affectedRows: result.rowsAffected?.[0] || undefined
    };
  }

  override async getPrimaryKeys(table: string, schema?: string): Promise<string[]> {
    const schemaFilter = schema || 'dbo';
    const result = await this.executeQuery(`
      SELECT ku.COLUMN_NAME as column_name
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
        ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
        AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
      WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        AND tc.TABLE_NAME = @table
        AND tc.TABLE_SCHEMA = @schema
      ORDER BY ku.ORDINAL_POSITION
    `, [table, schemaFilter]);
    
    return result.rows.map(row => row.column_name as string);
  }

  override async insertRow(table: string, data: Record<string, unknown>, schema?: string): Promise<QueryResult> {
    this.assertWriteAllowed();
    const schemaFilter = schema || 'dbo';
    const columns = Object.keys(data);
    const values = Object.values(data);
    
    const sql = `
      INSERT INTO [${schemaFilter}].[${table}] (${columns.map(c => `[${c}]`).join(', ')})
      OUTPUT INSERTED.*
      VALUES (${columns.map((_, i) => `@param${i}`).join(', ')})
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
    const schemaFilter = schema || 'dbo';
    const setClauses: string[] = [];
    const whereClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 0;

    for (const [col, val] of Object.entries(data)) {
      setClauses.push(`[${col}] = @param${paramIndex}`);
      values.push(val);
      paramIndex++;
    }

    for (const [col, val] of Object.entries(primaryKeyValues)) {
      whereClauses.push(`[${col}] = @param${paramIndex}`);
      values.push(val);
      paramIndex++;
    }

    const sql = `
      UPDATE [${schemaFilter}].[${table}]
      SET ${setClauses.join(', ')}
      OUTPUT INSERTED.*
      WHERE ${whereClauses.join(' AND ')}
    `;

    return this.executeQuery(sql, values);
  }

  override async deleteRow(table: string, primaryKeyValues: Record<string, unknown>, schema?: string): Promise<QueryResult> {
    this.assertWriteAllowed();
    const schemaFilter = schema || 'dbo';
    const whereClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 0;

    for (const [col, val] of Object.entries(primaryKeyValues)) {
      whereClauses.push(`[${col}] = @param${paramIndex}`);
      values.push(val);
      paramIndex++;
    }

    const sql = `
      DELETE FROM [${schemaFilter}].[${table}]
      OUTPUT DELETED.*
      WHERE ${whereClauses.join(' AND ')}
    `;

    return this.executeQuery(sql, values);
  }
}

// Register the driver with the factory
DriverFactory.register(mssqlMetadata, MssqlDriver);
