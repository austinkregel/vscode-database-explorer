import { DriverCapabilities } from '../types';

/**
 * Full SQL database capabilities (PostgreSQL, MySQL, MSSQL, Oracle)
 */
export const SQL_FULL_CAPABILITIES: DriverCapabilities = {
  supportsSchemas: true,
  supportsTables: true,
  supportsViews: true,
  supportsCollections: false,
  supportsMeasurements: false,
  supportsSQL: true,
  supportsNoSQLQueries: false,
  supportsFlux: false,
  supportsPromQL: false,
  supportsInsert: true,
  supportsUpdate: true,
  supportsDelete: true,
  supportsTruncate: true,
  supportsDDL: true,
  supportsTransactions: true,
  supportsPrimaryKeys: true,
  supportsExport: true,
  supportsRowEditing: true,
  treeStructure: 'schema-table-column'
};

/**
 * SQLite capabilities (no schema support)
 */
export const SQLITE_CAPABILITIES: DriverCapabilities = {
  ...SQL_FULL_CAPABILITIES,
  supportsSchemas: false,
  treeStructure: 'database-table-column'
};

/**
 * MySQL capabilities
 */
export const MYSQL_CAPABILITIES: DriverCapabilities = {
  ...SQL_FULL_CAPABILITIES,
  // MySQL uses databases instead of schemas in the traditional sense
  supportsSchemas: true,
  treeStructure: 'schema-table-column'
};

/**
 * MongoDB capabilities
 */
export const MONGODB_CAPABILITIES: DriverCapabilities = {
  supportsSchemas: false,
  supportsTables: false,
  supportsViews: false,
  supportsCollections: true,
  supportsMeasurements: false,
  supportsSQL: false,
  supportsNoSQLQueries: true,
  supportsFlux: false,
  supportsPromQL: false,
  supportsInsert: true,
  supportsUpdate: true,
  supportsDelete: true,
  supportsTruncate: true,
  supportsDDL: false,
  supportsTransactions: true, // MongoDB 4.0+ supports transactions
  supportsPrimaryKeys: true, // _id field
  supportsExport: true,
  supportsRowEditing: true,
  treeStructure: 'database-collection'
};

/**
 * Redis capabilities
 */
export const REDIS_CAPABILITIES: DriverCapabilities = {
  supportsSchemas: false,
  supportsTables: false,
  supportsViews: false,
  supportsCollections: false,
  supportsMeasurements: false,
  supportsSQL: false,
  supportsNoSQLQueries: true,
  supportsFlux: false,
  supportsPromQL: false,
  supportsInsert: true,
  supportsUpdate: true,
  supportsDelete: true,
  supportsTruncate: true,
  supportsDDL: false,
  supportsTransactions: false,
  supportsPrimaryKeys: true, // Keys are primary identifiers
  supportsExport: true,
  supportsRowEditing: true,
  treeStructure: 'keyspace'
};

/**
 * InfluxDB capabilities
 */
export const INFLUXDB_CAPABILITIES: DriverCapabilities = {
  supportsSchemas: false,
  supportsTables: false,
  supportsViews: false,
  supportsCollections: false,
  supportsMeasurements: true,
  supportsSQL: false,
  supportsNoSQLQueries: false,
  supportsFlux: true,
  supportsPromQL: false,
  supportsInsert: true,
  supportsUpdate: false, // InfluxDB doesn't support updates
  supportsDelete: true,  // Can delete by time range
  supportsTruncate: false,
  supportsDDL: false,
  supportsTransactions: false,
  supportsPrimaryKeys: false,
  supportsExport: true,
  supportsRowEditing: false,
  treeStructure: 'bucket-measurement'
};

/**
 * Prometheus capabilities (read-only)
 */
export const PROMETHEUS_CAPABILITIES: DriverCapabilities = {
  supportsSchemas: false,
  supportsTables: false,
  supportsViews: false,
  supportsCollections: false,
  supportsMeasurements: true,
  supportsSQL: false,
  supportsNoSQLQueries: false,
  supportsFlux: false,
  supportsPromQL: true,
  supportsInsert: false,
  supportsUpdate: false,
  supportsDelete: false,
  supportsTruncate: false,
  supportsDDL: false,
  supportsTransactions: false,
  supportsPrimaryKeys: false,
  supportsExport: true,
  supportsRowEditing: false,
  treeStructure: 'metric-label'
};

/**
 * DynamoDB capabilities
 */
export const DYNAMODB_CAPABILITIES: DriverCapabilities = {
  supportsSchemas: false,
  supportsTables: true,
  supportsViews: false,
  supportsCollections: false,
  supportsMeasurements: false,
  supportsSQL: false, // PartiQL support could be added
  supportsNoSQLQueries: true,
  supportsFlux: false,
  supportsPromQL: false,
  supportsInsert: true,
  supportsUpdate: true,
  supportsDelete: true,
  supportsTruncate: false,
  supportsDDL: true,
  supportsTransactions: true,
  supportsPrimaryKeys: true,
  supportsExport: true,
  supportsRowEditing: true,
  treeStructure: 'database-collection'
};

/**
 * Check if a capability is enabled, considering connection-level read-only mode
 */
export function isWriteAllowed(capabilities: DriverCapabilities, connectionReadOnly?: boolean): boolean {
  if (connectionReadOnly) {
    return false;
  }
  return capabilities.supportsInsert || capabilities.supportsUpdate || capabilities.supportsDelete;
}

/**
 * Get the effective capabilities considering connection-level read-only mode
 */
export function getEffectiveCapabilities(
  capabilities: DriverCapabilities, 
  connectionReadOnly?: boolean
): DriverCapabilities {
  if (!connectionReadOnly) {
    return capabilities;
  }
  
  return {
    ...capabilities,
    supportsInsert: false,
    supportsUpdate: false,
    supportsDelete: false,
    supportsTruncate: false,
    supportsDDL: false,
    supportsRowEditing: false
  };
}
