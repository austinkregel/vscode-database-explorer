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
import { PROMETHEUS_CAPABILITIES } from './capabilities';
import { DriverFactory } from './driverFactory';

/**
 * Prometheus driver metadata
 */
export const prometheusMetadata: DriverMetadata = {
  id: 'prometheus',
  displayName: 'Prometheus',
  icon: '$(graph)',
  category: 'timeseries',
  defaultPort: 9090,
  capabilities: PROMETHEUS_CAPABILITIES,
  connectionFields: [
    { key: 'host', label: 'URL', type: 'text', required: true, placeholder: 'http://localhost:9090', group: 'basic' },
    { key: 'username', label: 'Username (optional)', type: 'text', required: false, group: 'basic' },
    { key: 'password', label: 'Password (optional)', type: 'password', required: false, group: 'basic' }
  ]
};

interface PrometheusQueryResult {
  status: string;
  data: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      value?: [number, string];
      values?: Array<[number, string]>;
    }>;
  };
  errorType?: string;
  error?: string;
}

interface PrometheusLabelResult {
  status: string;
  data: string[];
}

export class PrometheusDriver extends BaseDbDriver {
  private baseUrl: string = '';
  private authHeader: string | null = null;

  constructor(config: ConnectionConfig, password: string = '') {
    super(config, password);
  }

  getMetadata(): DriverMetadata {
    return prometheusMetadata;
  }

  async connect(): Promise<void> {
    this.baseUrl = (this.config.host as string) || 'http://localhost:9090';
    
    // Remove trailing slash
    if (this.baseUrl.endsWith('/')) {
      this.baseUrl = this.baseUrl.slice(0, -1);
    }
    
    // Set up basic auth if credentials provided
    if (this.config.username && this.password) {
      const credentials = Buffer.from(`${this.config.username}:${this.password}`).toString('base64');
      this.authHeader = `Basic ${credentials}`;
    }
    
    // Test connection by querying the API
    try {
      await this.fetchPrometheus('/api/v1/status/buildinfo');
      this.connected = true;
    } catch (error) {
      throw new Error(`Failed to connect to Prometheus: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    this.baseUrl = '';
    this.authHeader = null;
    this.connected = false;
  }

  override isConnected(): boolean {
    return this.connected && this.baseUrl !== '';
  }

  // ============================================================================
  // SQL-style methods adapted for Prometheus
  // ============================================================================

  override async getSchemas(): Promise<SchemaInfo[]> {
    // Prometheus doesn't have schemas, return a single "metrics" schema
    return [{ name: 'metrics' }];
  }

  override async getTables(schema?: string): Promise<TableInfo[]> {
    // In Prometheus, "tables" are metrics
    const measurements = await this.getMeasurements();
    return measurements.map(m => ({
      name: m.name,
      schema: 'metrics'
    }));
  }

  override async executeQuery(promQuery: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.connected) {
      throw new Error('Not connected to Prometheus');
    }

    // Execute instant query
    const response = await this.fetchPrometheus<PrometheusQueryResult>(
      `/api/v1/query?query=${encodeURIComponent(promQuery)}`
    );
    
    if (response.status !== 'success') {
      throw new Error(`Prometheus query failed: ${response.error || 'Unknown error'}`);
    }
    
    const rows: Record<string, unknown>[] = [];
    const columns = new Set<string>(['__name__', 'value', 'timestamp']);
    
    for (const result of response.data.result) {
      const row: Record<string, unknown> = { ...result.metric };
      
      // Add all metric labels as columns
      Object.keys(result.metric).forEach(key => columns.add(key));
      
      if (result.value) {
        row.timestamp = new Date(result.value[0] * 1000).toISOString();
        row.value = parseFloat(result.value[1]);
      }
      
      rows.push(row);
    }
    
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
    if (!this.connected) {
      throw new Error('Not connected to Prometheus');
    }

    const response = await this.fetchPrometheus<PrometheusLabelResult>('/api/v1/label/__name__/values');
    
    if (response.status !== 'success') {
      throw new Error('Failed to fetch metrics');
    }
    
    return response.data.map(name => ({
      name,
      retentionPolicy: undefined
    }));
  }

  override async getFields(measurement: string): Promise<FieldInfo[]> {
    // Prometheus metrics have a single value field
    return [{
      name: 'value',
      type: 'gauge/counter/histogram/summary'
    }];
  }

  override async getTags(measurement: string): Promise<TagInfo[]> {
    if (!this.connected) {
      throw new Error('Not connected to Prometheus');
    }

    // Get all labels for this metric
    const response = await this.fetchPrometheus<PrometheusLabelResult>(
      `/api/v1/labels?match[]=${encodeURIComponent(measurement)}`
    );
    
    if (response.status !== 'success') {
      return [];
    }
    
    return response.data
      .filter(label => label !== '__name__')
      .map(name => ({ name }));
  }

  override async queryTimeRange(query: TimeSeriesQuery): Promise<TimeSeriesResult> {
    if (!this.connected) {
      throw new Error('Not connected to Prometheus');
    }

    const startTime = Math.floor(query.start.getTime() / 1000);
    const endTime = Math.floor(query.end.getTime() / 1000);
    const step = this.parseInterval(query.interval || '1m');
    
    // Build PromQL query with aggregation if specified
    let promQuery = query.measurement;
    if (query.aggregation) {
      const aggFunc = this.mapAggregation(query.aggregation);
      promQuery = `${aggFunc}(${query.measurement})`;
    }
    
    const url = `/api/v1/query_range?query=${encodeURIComponent(promQuery)}&start=${startTime}&end=${endTime}&step=${step}`;
    const response = await this.fetchPrometheus<PrometheusQueryResult>(url);
    
    if (response.status !== 'success') {
      throw new Error(`Prometheus query failed: ${response.error || 'Unknown error'}`);
    }
    
    const timestamps: Date[] = [];
    const seriesMap = new Map<string, number[]>();
    
    for (const result of response.data.result) {
      const seriesName = this.buildSeriesName(result.metric);
      const values: number[] = [];
      
      if (result.values) {
        for (const [ts, val] of result.values) {
          if (timestamps.length < result.values.length) {
            timestamps.push(new Date(ts * 1000));
          }
          values.push(parseFloat(val));
        }
      }
      
      seriesMap.set(seriesName, values);
    }
    
    const series = Array.from(seriesMap.entries()).map(([name, values]) => ({
      name,
      values
    }));
    
    return { timestamps, series };
  }

  // ============================================================================
  // Helper methods
  // ============================================================================

  private async fetchPrometheus<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };
    
    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }
    
    const response = await fetch(`${this.baseUrl}${path}`, { headers });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response.json() as Promise<T>;
  }

  private parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 60; // Default to 1 minute
    }
    
    const value = parseInt(match[1], 10);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 60;
    }
  }

  private mapAggregation(agg: string): string {
    switch (agg) {
      case 'mean': return 'avg';
      case 'sum': return 'sum';
      case 'count': return 'count';
      case 'min': return 'min';
      case 'max': return 'max';
      default: return 'avg';
    }
  }

  private buildSeriesName(metric: Record<string, string>): string {
    const name = metric.__name__ || 'value';
    const labels = Object.entries(metric)
      .filter(([k]) => k !== '__name__')
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    
    return labels ? `${name}{${labels}}` : name;
  }
}

// Register the driver with the factory
DriverFactory.register(prometheusMetadata, PrometheusDriver);
