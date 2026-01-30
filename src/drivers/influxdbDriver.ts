import { InfluxDB, QueryApi, FluxTableMetaData } from '@influxdata/influxdb-client';
import { 
  DriverMetadata, 
  SchemaInfo, 
  TableInfo, 
  QueryResult, 
  ConnectionConfig,
  MeasurementInfo,
  FieldInfo,
  TagInfo,
  TimeSeriesQuery,
  TimeSeriesResult
} from '../types';
import { BaseDbDriver } from './baseDriver';
import { INFLUXDB_CAPABILITIES } from './capabilities';
import { DriverFactory } from './driverFactory';

/**
 * InfluxDB driver metadata
 */
export const influxdbMetadata: DriverMetadata = {
  id: 'influxdb',
  displayName: 'InfluxDB',
  icon: '$(graph-line)',
  category: 'timeseries',
  defaultPort: 8086,
  capabilities: INFLUXDB_CAPABILITIES,
  connectionFields: [
    { key: 'host', label: 'URL', type: 'text', required: true, placeholder: 'http://localhost:8086', group: 'basic' },
    { key: 'organization', label: 'Organization', type: 'text', required: true, placeholder: 'my-org', group: 'basic' },
    { key: 'bucket', label: 'Bucket', type: 'text', required: true, placeholder: 'my-bucket', group: 'basic' },
    { key: 'token', label: 'API Token', type: 'password', required: true, group: 'basic' },
    { key: 'readOnly', label: 'Read-only mode', type: 'checkbox', required: false, defaultValue: false, group: 'advanced' }
  ]
};

export class InfluxDbDriver extends BaseDbDriver {
  private client: InfluxDB | null = null;
  private queryApi: QueryApi | null = null;
  private organization: string = '';
  private bucket: string = '';

  constructor(config: ConnectionConfig, password: string = '') {
    super(config, password);
    this.organization = (config.organization as string) || '';
    this.bucket = (config.bucket as string) || '';
  }

  getMetadata(): DriverMetadata {
    return influxdbMetadata;
  }

  async connect(): Promise<void> {
    const url = this.config.host || 'http://localhost:8086';
    // Token can be in password field or in config
    const token = this.password || (this.config.token as string) || '';
    
    this.client = new InfluxDB({ url, token });
    this.queryApi = this.client.getQueryApi(this.organization);
    
    // Test connection by running a simple query
    try {
      const query = `buckets() |> limit(n: 1)`;
      const results: unknown[] = [];
      
      await new Promise<void>((resolve, reject) => {
        this.queryApi!.queryRows(query, {
          next: (row: string[], tableMeta: FluxTableMetaData) => {
            results.push(tableMeta.toObject(row));
          },
          error: (error: Error) => {
            reject(error);
          },
          complete: () => {
            resolve();
          }
        });
      });
      
      this.connected = true;
    } catch (error) {
      throw new Error(`Failed to connect to InfluxDB: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.queryApi = null;
    this.connected = false;
  }

  override isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  // ============================================================================
  // SQL-style methods adapted for InfluxDB
  // ============================================================================

  override async getSchemas(): Promise<SchemaInfo[]> {
    // In InfluxDB, buckets are like schemas/databases
    const buckets = await this.getBuckets();
    return buckets.map(name => ({ name }));
  }

  override async getTables(schema?: string): Promise<TableInfo[]> {
    // In InfluxDB, measurements are like tables
    const measurements = await this.getMeasurements();
    return measurements.map(m => ({
      name: m.name,
      schema: this.bucket
    }));
  }

  override async executeQuery(fluxQuery: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.queryApi) {
      throw new Error('Not connected to InfluxDB');
    }

    // For InfluxDB, we don't check for write queries in the same way
    // Flux queries are typically read-only through the query API
    
    const rows: Record<string, unknown>[] = [];
    const columns = new Set<string>();
    
    await new Promise<void>((resolve, reject) => {
      this.queryApi!.queryRows(fluxQuery, {
        next: (row: string[], tableMeta: FluxTableMetaData) => {
          const obj = tableMeta.toObject(row);
          rows.push(obj as Record<string, unknown>);
          Object.keys(obj).forEach(key => columns.add(key));
        },
        error: (error: Error) => {
          reject(error);
        },
        complete: () => {
          resolve();
        }
      });
    });

    return {
      columns: Array.from(columns),
      rows,
      rowCount: rows.length
    };
  }

  // ============================================================================
  // Time-series specific methods
  // ============================================================================

  override async getMeasurements(): Promise<MeasurementInfo[]> {
    if (!this.queryApi) {
      throw new Error('Not connected to InfluxDB');
    }

    const query = `
      import "influxdata/influxdb/schema"
      schema.measurements(bucket: "${this.bucket}")
    `;
    
    const result = await this.executeQuery(query);
    return result.rows.map(row => ({
      name: row._value as string,
      retentionPolicy: undefined
    }));
  }

  override async getFields(measurement: string): Promise<FieldInfo[]> {
    if (!this.queryApi) {
      throw new Error('Not connected to InfluxDB');
    }

    const query = `
      import "influxdata/influxdb/schema"
      schema.measurementFieldKeys(bucket: "${this.bucket}", measurement: "${measurement}")
    `;
    
    const result = await this.executeQuery(query);
    return result.rows.map(row => ({
      name: row._value as string,
      type: 'field'
    }));
  }

  override async getTags(measurement: string): Promise<TagInfo[]> {
    if (!this.queryApi) {
      throw new Error('Not connected to InfluxDB');
    }

    const query = `
      import "influxdata/influxdb/schema"
      schema.measurementTagKeys(bucket: "${this.bucket}", measurement: "${measurement}")
    `;
    
    const result = await this.executeQuery(query);
    return result.rows.map(row => ({
      name: row._value as string
    }));
  }

  override async queryTimeRange(query: TimeSeriesQuery): Promise<TimeSeriesResult> {
    if (!this.queryApi) {
      throw new Error('Not connected to InfluxDB');
    }

    const startTime = query.start.toISOString();
    const endTime = query.end.toISOString();
    const aggregation = query.aggregation || 'mean';
    const interval = query.interval || '1m';

    const fluxQuery = `
      from(bucket: "${this.bucket}")
        |> range(start: ${startTime}, stop: ${endTime})
        |> filter(fn: (r) => r._measurement == "${query.measurement}")
        |> aggregateWindow(every: ${interval}, fn: ${aggregation}, createEmpty: false)
        |> yield(name: "result")
    `;
    
    const result = await this.executeQuery(fluxQuery);
    
    // Group by field name
    const seriesMap = new Map<string, { timestamps: Date[]; values: number[] }>();
    
    for (const row of result.rows) {
      const field = row._field as string || 'value';
      const time = new Date(row._time as string);
      const value = row._value as number;
      
      if (!seriesMap.has(field)) {
        seriesMap.set(field, { timestamps: [], values: [] });
      }
      
      const series = seriesMap.get(field)!;
      series.timestamps.push(time);
      series.values.push(value);
    }
    
    // Build result
    let timestamps: Date[] = [];
    if (seriesMap.size > 0) {
      const firstSeries = seriesMap.values().next().value;
      if (firstSeries) {
        timestamps = firstSeries.timestamps;
      }
    }
    
    const series = Array.from(seriesMap.entries()).map(([name, data]) => ({
      name,
      values: data.values
    }));
    
    return { timestamps, series };
  }

  // ============================================================================
  // Helper methods
  // ============================================================================

  private async getBuckets(): Promise<string[]> {
    if (!this.queryApi) {
      throw new Error('Not connected to InfluxDB');
    }

    const query = `buckets() |> keep(columns: ["name"])`;
    const result = await this.executeQuery(query);
    
    return result.rows
      .map(row => row.name as string)
      .filter(name => !name.startsWith('_'));
  }
}

// Register the driver with the factory
DriverFactory.register(influxdbMetadata, InfluxDbDriver);
