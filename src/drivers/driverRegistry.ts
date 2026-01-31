import { DbDriver, DriverMetadata, DriverCapabilities } from '../types';
import { ConnectionStore } from '../storage/connectionStore';
import { DriverFactory } from './driverFactory';

// Track which drivers failed to load
const driverLoadErrors: Map<string, string> = new Map();

/**
 * Safely import a driver module. If it fails (e.g., missing native dependency),
 * log the error but don't crash the extension.
 */
function safeImportDriver(driverName: string, importFn: () => void): void {
  try {
    importFn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to load ${driverName} driver: ${message}`);
    driverLoadErrors.set(driverName, message);
  }
}

// Import all drivers to trigger their self-registration
// Using require() for dynamic imports that can be caught
safeImportDriver('postgres', () => require('./postgresDriver'));
safeImportDriver('mysql', () => require('./mysqlDriver'));
safeImportDriver('sqlite', () => require('./sqliteDriver'));
safeImportDriver('mssql', () => require('./mssqlDriver'));
safeImportDriver('mongodb', () => require('./mongoDriver'));
safeImportDriver('influxdb', () => require('./influxdbDriver'));
safeImportDriver('prometheus', () => require('./prometheusDriver'));

/**
 * DriverRegistry - Manages database driver instances and connections
 * 
 * Uses the DriverFactory for driver creation, which supports a plugin-style
 * architecture where new drivers self-register.
 */
export class DriverRegistry {
  private drivers: Map<string, DbDriver> = new Map();
  private connectionStore: ConnectionStore;

  constructor(connectionStore: ConnectionStore) {
    this.connectionStore = connectionStore;
  }

  /**
   * Connect to a database using the stored connection configuration
   */
  async connect(connectionId: string): Promise<DbDriver> {
    // If already connected, return existing driver
    const existing = this.drivers.get(connectionId);
    if (existing?.isConnected()) {
      return existing;
    }

    const config = await this.connectionStore.getConnection(connectionId);
    if (!config) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    const password = await this.connectionStore.getPassword(connectionId);
    const driver = DriverFactory.create(config.type, config, password || '');

    await driver.connect();
    this.drivers.set(connectionId, driver);
    
    return driver;
  }

  /**
   * Disconnect a specific connection
   */
  async disconnect(connectionId: string): Promise<void> {
    const driver = this.drivers.get(connectionId);
    if (driver) {
      await driver.disconnect();
      this.drivers.delete(connectionId);
    }
  }

  /**
   * Disconnect all connections
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.drivers.values()).map(driver => 
      driver.disconnect().catch(err => console.error('Error disconnecting:', err))
    );
    await Promise.all(disconnectPromises);
    this.drivers.clear();
  }

  /**
   * Get an existing driver instance
   */
  getDriver(connectionId: string): DbDriver | undefined {
    return this.drivers.get(connectionId);
  }

  /**
   * Check if a connection is active
   */
  isConnected(connectionId: string): boolean {
    const driver = this.drivers.get(connectionId);
    return driver?.isConnected() ?? false;
  }

  /**
   * Get all available driver types
   */
  getAvailableDrivers(): DriverMetadata[] {
    return DriverFactory.getAvailableDrivers();
  }

  /**
   * Get metadata for a specific driver type
   */
  getDriverMetadata(type: string): DriverMetadata | undefined {
    return DriverFactory.getMetadata(type);
  }

  /**
   * Get capabilities for a specific driver type
   */
  getDriverCapabilities(type: string): DriverCapabilities | undefined {
    return DriverFactory.getCapabilities(type);
  }

  /**
   * Get capabilities for a connected driver
   */
  getConnectedDriverCapabilities(connectionId: string): DriverCapabilities | undefined {
    const driver = this.drivers.get(connectionId);
    if (driver) {
      return driver.getMetadata().capabilities;
    }
    return undefined;
  }

  /**
   * Check if a driver type failed to load
   */
  getDriverLoadError(driverType: string): string | undefined {
    return driverLoadErrors.get(driverType);
  }

  /**
   * Get all driver load errors (for diagnostics)
   */
  getAllDriverLoadErrors(): Map<string, string> {
    return new Map(driverLoadErrors);
  }
}
