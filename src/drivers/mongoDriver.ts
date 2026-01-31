import { MongoClient, Db, Document } from 'mongodb';
import { 
  DriverMetadata, 
  SchemaInfo, 
  TableInfo, 
  ViewInfo, 
  ColumnInfo, 
  QueryResult, 
  ConnectionConfig,
  CollectionInfo,
  DocumentResult
} from '../types';
import { BaseDbDriver } from './baseDriver';
import { MONGODB_CAPABILITIES } from './capabilities';
import { DriverFactory } from './driverFactory';

/**
 * MongoDB driver metadata
 */
export const mongoMetadata: DriverMetadata = {
  id: 'mongodb',
  displayName: 'MongoDB',
  icon: '$(json)',
  category: 'document',
  defaultPort: 27017,
  capabilities: MONGODB_CAPABILITIES,
  connectionFields: [
    { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'localhost', group: 'basic' },
    { key: 'port', label: 'Port', type: 'number', required: true, defaultValue: 27017, group: 'basic' },
    { key: 'database', label: 'Database', type: 'text', required: true, placeholder: 'mydb', group: 'basic' },
    { key: 'username', label: 'Username', type: 'text', required: false, placeholder: 'admin', group: 'basic' },
    { key: 'password', label: 'Password', type: 'password', required: false, group: 'basic' },
    { key: 'authSource', label: 'Auth Source', type: 'text', required: false, placeholder: 'admin', group: 'advanced' },
    { key: 'replicaSet', label: 'Replica Set', type: 'text', required: false, group: 'advanced' },
    { key: 'readOnly', label: 'Read-only mode', type: 'checkbox', required: false, defaultValue: false, group: 'advanced' }
  ]
};

export class MongoDriver extends BaseDbDriver {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(config: ConnectionConfig, password: string = '') {
    super(config, password);
  }

  getMetadata(): DriverMetadata {
    return mongoMetadata;
  }

  async connect(): Promise<void> {
    // Build connection URI
    let uri = 'mongodb://';
    
    if (this.config.username) {
      uri += encodeURIComponent(this.config.username);
      if (this.password) {
        uri += ':' + encodeURIComponent(this.password);
      }
      uri += '@';
    }
    
    uri += `${this.config.host || 'localhost'}:${this.config.port || 27017}`;
    uri += `/${this.config.database || 'test'}`;
    
    // Add options
    const options: string[] = [];
    if (this.config.authSource) {
      options.push(`authSource=${this.config.authSource}`);
    }
    if (this.config.replicaSet) {
      options.push(`replicaSet=${this.config.replicaSet}`);
    }
    if (options.length > 0) {
      uri += '?' + options.join('&');
    }

    this.client = new MongoClient(uri);
    await this.client.connect();
    this.db = this.client.db(this.config.database as string);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
    this.connected = false;
  }

  override isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  // ============================================================================
  // SQL-style methods - adapted for MongoDB
  // ============================================================================

  override async getSchemas(): Promise<SchemaInfo[]> {
    // MongoDB doesn't have schemas, but we can list databases
    if (!this.client) {
      throw new Error('Not connected to database');
    }
    
    const admin = this.client.db().admin();
    const result = await admin.listDatabases();
    return result.databases
      .filter((db: { name: string }) => !['admin', 'config', 'local'].includes(db.name))
      .map((db: { name: string }) => ({ name: db.name }));
  }

  override async getTables(schema?: string): Promise<TableInfo[]> {
    // In MongoDB, "tables" are collections
    const collections = await this.getCollections();
    return collections.map(col => ({
      name: col.name,
      schema: this.config.database as string
    }));
  }

  override async getViews(schema?: string): Promise<ViewInfo[]> {
    // MongoDB views - list views from listCollections with type: 'view'
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    
    const collections = await this.db.listCollections({ type: 'view' }).toArray();
    return collections.map((col: { name: string }) => ({
      name: col.name,
      schema: this.config.database as string
    }));
  }

  override async getDDL(table: string, schema?: string): Promise<string> {
    // Return collection info as JSON
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    
    const collections = await this.db.listCollections({ name: table }).toArray();
    if (collections.length === 0) {
      throw new Error(`Collection not found: ${table}`);
    }
    
    return JSON.stringify(collections[0], null, 2);
  }

  override async getColumns(table: string, schema?: string): Promise<ColumnInfo[]> {
    // MongoDB is schemaless, but we can sample documents to infer fields
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    
    const collection = this.db.collection(table);
    const sample = await collection.findOne({});
    
    if (!sample) {
      return [];
    }
    
    return Object.keys(sample).map(key => ({
      name: key,
      dataType: this.getMongoType(sample[key]),
      nullable: true,
      isPrimaryKey: key === '_id',
      defaultValue: undefined
    }));
  }

  override async executeQuery(sqlQuery: string, params?: unknown[]): Promise<QueryResult> {
    // For MongoDB, we interpret the query as a JSON find/aggregate operation
    // This is a simplified implementation - a real one would parse MongoDB query syntax
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    this.validateQuery(sqlQuery);

    try {
      // Try to parse as JSON query: { collection: "...", operation: "find/aggregate", query: {...} }
      const parsed = JSON.parse(sqlQuery);
      const collection = this.db.collection(parsed.collection);
      
      let docs: Document[];
      if (parsed.operation === 'aggregate') {
        docs = await collection.aggregate(parsed.query || []).toArray();
      } else {
        docs = await collection.find(parsed.query || {}).limit(parsed.limit || 100).toArray();
      }
      
      const columns = docs.length > 0 ? Object.keys(docs[0]) : [];
      return {
        columns,
        rows: docs as Record<string, unknown>[],
        rowCount: docs.length
      };
    } catch {
      // If not valid JSON, return an error
      throw new Error('MongoDB queries must be in JSON format: { "collection": "name", "operation": "find|aggregate", "query": {...} }');
    }
  }

  override async getPrimaryKeys(table: string, schema?: string): Promise<string[]> {
    // MongoDB always uses _id as the primary key
    return ['_id'];
  }

  override async insertRow(table: string, data: Record<string, unknown>, schema?: string): Promise<QueryResult> {
    this.assertWriteAllowed();
    
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    
    const collection = this.db.collection(table);
    const result = await collection.insertOne(data as Document);
    
    // Fetch the inserted document
    const inserted = await collection.findOne({ _id: result.insertedId });
    
    return {
      columns: inserted ? Object.keys(inserted) : [],
      rows: inserted ? [inserted as Record<string, unknown>] : [],
      rowCount: 1,
      affectedRows: 1
    };
  }

  override async updateRow(
    table: string, 
    primaryKeyValues: Record<string, unknown>, 
    data: Record<string, unknown>, 
    schema?: string
  ): Promise<QueryResult> {
    this.assertWriteAllowed();
    
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    
    const collection = this.db.collection(table);
    await collection.updateOne(primaryKeyValues as Document, { $set: data });
    
    // Fetch the updated document
    const updated = await collection.findOne(primaryKeyValues as Document);
    
    return {
      columns: updated ? Object.keys(updated) : [],
      rows: updated ? [updated as Record<string, unknown>] : [],
      rowCount: 1,
      affectedRows: 1
    };
  }

  override async deleteRow(table: string, primaryKeyValues: Record<string, unknown>, schema?: string): Promise<QueryResult> {
    this.assertWriteAllowed();
    
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    
    const collection = this.db.collection(table);
    
    // Fetch before delete
    const toDelete = await collection.findOne(primaryKeyValues as Document);
    
    const result = await collection.deleteOne(primaryKeyValues as Document);
    
    return {
      columns: toDelete ? Object.keys(toDelete) : [],
      rows: toDelete ? [toDelete as Record<string, unknown>] : [],
      rowCount: 0,
      affectedRows: result.deletedCount
    };
  }

  // ============================================================================
  // NoSQL-specific methods
  // ============================================================================

  override async getCollections(): Promise<CollectionInfo[]> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    
    const collections = await this.db.listCollections({ type: 'collection' }).toArray();
    return collections.map((col: { name: string }) => ({
      name: col.name,
      database: this.config.database as string
    }));
  }

  override async getDocuments(collectionName: string, filter?: Record<string, unknown>): Promise<DocumentResult> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    
    const collection = this.db.collection(collectionName);
    const docs = await collection.find(filter as Document || {}).limit(100).toArray();
    
    return {
      documents: docs as Record<string, unknown>[],
      count: docs.length
    };
  }

  override async insertDocument(collectionName: string, doc: Record<string, unknown>): Promise<void> {
    this.assertWriteAllowed();
    
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    
    const collection = this.db.collection(collectionName);
    await collection.insertOne(doc as Document);
  }

  override async updateDocument(
    collectionName: string, 
    filter: Record<string, unknown>, 
    update: Record<string, unknown>
  ): Promise<void> {
    this.assertWriteAllowed();
    
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    
    const collection = this.db.collection(collectionName);
    await collection.updateMany(filter as Document, { $set: update });
  }

  override async deleteDocument(collectionName: string, filter: Record<string, unknown>): Promise<void> {
    this.assertWriteAllowed();
    
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    
    const collection = this.db.collection(collectionName);
    await collection.deleteMany(filter as Document);
  }

  // ============================================================================
  // Helper methods
  // ============================================================================

  private getMongoType(value: unknown): string {
    if (value === null) { return 'null'; }
    if (value === undefined) { return 'undefined'; }
    if (Array.isArray(value)) { return 'array'; }
    if (value instanceof Date) { return 'date'; }
    if (typeof value === 'object') {
      if ('_bsontype' in (value as object)) {
        return (value as { _bsontype: string })._bsontype.toLowerCase();
      }
      return 'object';
    }
    return typeof value;
  }
}

// Register the driver with the factory
DriverFactory.register(mongoMetadata, MongoDriver);
