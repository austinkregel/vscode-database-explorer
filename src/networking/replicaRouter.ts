import { DbDriver, ReplicaConfig, ConnectionConfig, QueryResult } from '../types';
import { DriverFactory } from '../drivers/driverFactory';

/**
 * Replica Router
 * 
 * Routes database queries to appropriate read or write replicas based on
 * the query type and configured load balancing strategy.
 */
export class ReplicaRouter {
  private writeDriver: DbDriver | null = null;
  private readDrivers: DbDriver[] = [];
  private currentReadIndex: number = 0;
  private config: ReplicaConfig;
  private baseConfig: ConnectionConfig;
  private password: string;

  constructor(config: ReplicaConfig, baseConfig: ConnectionConfig, password: string) {
    this.config = config;
    this.baseConfig = baseConfig;
    this.password = password;
  }

  /**
   * Connect to all replicas
   */
  async connect(): Promise<void> {
    // Connect to write replica
    const writeConfig: ConnectionConfig = {
      ...this.baseConfig,
      host: this.config.writeHost,
      port: this.config.writePort
    };
    this.writeDriver = DriverFactory.create(this.baseConfig.type, writeConfig, this.password);
    await this.writeDriver.connect();

    // Connect to read replicas
    for (const readHost of this.config.readHosts) {
      const readConfig: ConnectionConfig = {
        ...this.baseConfig,
        host: readHost.host,
        port: readHost.port
      };
      const readDriver = DriverFactory.create(this.baseConfig.type, readConfig, this.password);
      await readDriver.connect();
      this.readDrivers.push(readDriver);
    }
  }

  /**
   * Disconnect from all replicas
   */
  async disconnect(): Promise<void> {
    if (this.writeDriver) {
      await this.writeDriver.disconnect();
      this.writeDriver = null;
    }

    for (const driver of this.readDrivers) {
      await driver.disconnect();
    }
    this.readDrivers = [];
  }

  /**
   * Get the write connection
   */
  getWriteDriver(): DbDriver {
    if (!this.writeDriver) {
      throw new Error('Write replica not connected');
    }
    return this.writeDriver;
  }

  /**
   * Get a read connection based on the load balancing strategy
   */
  getReadDriver(): DbDriver {
    if (this.readDrivers.length === 0) {
      // Fall back to write driver if no read replicas configured
      return this.getWriteDriver();
    }

    let driver: DbDriver;

    switch (this.config.loadBalancing) {
      case 'round-robin':
        driver = this.readDrivers[this.currentReadIndex];
        this.currentReadIndex = (this.currentReadIndex + 1) % this.readDrivers.length;
        break;

      case 'random':
        const randomIndex = Math.floor(Math.random() * this.readDrivers.length);
        driver = this.readDrivers[randomIndex];
        break;

      case 'first-available':
        // Return the first connected driver
        driver = this.readDrivers.find(d => d.isConnected()) || this.readDrivers[0];
        break;

      default:
        driver = this.readDrivers[0];
    }

    // Ensure the driver is connected
    if (!driver.isConnected()) {
      // Fall back to write driver
      return this.getWriteDriver();
    }

    return driver;
  }

  /**
   * Execute a query on the appropriate replica
   * Write queries go to the write replica, read queries go to a read replica
   */
  async executeQuery(sql: string, params?: unknown[]): Promise<QueryResult> {
    const isWriteQuery = this.isWriteQuery(sql);
    const driver = isWriteQuery ? this.getWriteDriver() : this.getReadDriver();
    return driver.executeQuery(sql, params);
  }

  /**
   * Check if a query is a write operation
   */
  private isWriteQuery(sql: string): boolean {
    const normalized = sql.trim().toLowerCase();
    return /^(insert|update|delete|drop|alter|create|truncate|grant|revoke)/i.test(normalized);
  }

  /**
   * Check if all replicas are connected
   */
  isConnected(): boolean {
    const writeConnected = this.writeDriver?.isConnected() ?? false;
    const readsConnected = this.readDrivers.length === 0 || 
      this.readDrivers.some(d => d.isConnected());
    return writeConnected && readsConnected;
  }

  /**
   * Get the number of connected read replicas
   */
  getConnectedReadReplicaCount(): number {
    return this.readDrivers.filter(d => d.isConnected()).length;
  }
}

/**
 * Factory function to create a replica router if replica config is present
 */
export function createReplicaRouterIfNeeded(
  config: ConnectionConfig,
  password: string
): ReplicaRouter | null {
  if (!config.replicaConfig?.enabled) {
    return null;
  }

  return new ReplicaRouter(config.replicaConfig, config, password);
}
