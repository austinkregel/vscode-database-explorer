import { DbDriver, DriverMetadata, ConnectionConfig, DriverCapabilities } from '../types';

/**
 * Constructor type for database drivers
 */
export type DriverConstructor = new (config: ConnectionConfig, password: string) => DbDriver;

/**
 * Driver registration entry containing metadata and constructor
 */
interface DriverRegistration {
  metadata: DriverMetadata;
  constructor: DriverConstructor;
}

/**
 * DriverFactory - Singleton factory for creating database drivers.
 * 
 * Drivers register themselves by calling DriverFactory.register() at module load time.
 * This allows for a plugin-style architecture where new drivers can be added without
 * modifying the factory code.
 * 
 * Usage:
 * ```typescript
 * // In driver file (e.g., postgresDriver.ts)
 * DriverFactory.register(postgresMetadata, PostgresDriver);
 * 
 * // To create a driver instance
 * const driver = DriverFactory.create('postgres', config, password);
 * ```
 */
export class DriverFactory {
  private static registry = new Map<string, DriverRegistration>();

  /**
   * Register a new driver type
   * @param metadata Driver metadata including id, name, capabilities
   * @param constructor Driver class constructor
   */
  static register(metadata: DriverMetadata, constructor: DriverConstructor): void {
    if (DriverFactory.registry.has(metadata.id)) {
      console.warn(`Driver '${metadata.id}' is already registered. Overwriting.`);
    }
    DriverFactory.registry.set(metadata.id, { metadata, constructor });
  }

  /**
   * Create a new driver instance
   * @param type Driver type ID (e.g., 'postgres', 'mysql', 'mongodb')
   * @param config Connection configuration
   * @param password Connection password (stored separately from config)
   * @returns New driver instance
   */
  static create(type: string, config: ConnectionConfig, password: string = ''): DbDriver {
    const registration = DriverFactory.registry.get(type);
    if (!registration) {
      const available = Array.from(DriverFactory.registry.keys()).join(', ');
      throw new Error(
        `Unknown driver type: '${type}'. Available drivers: ${available || 'none registered'}`
      );
    }
    return new registration.constructor(config, password);
  }

  /**
   * Get metadata for a specific driver type
   * @param type Driver type ID
   * @returns Driver metadata or undefined if not found
   */
  static getMetadata(type: string): DriverMetadata | undefined {
    return DriverFactory.registry.get(type)?.metadata;
  }

  /**
   * Get capabilities for a specific driver type
   * @param type Driver type ID
   * @returns Driver capabilities or undefined if not found
   */
  static getCapabilities(type: string): DriverCapabilities | undefined {
    return DriverFactory.registry.get(type)?.metadata.capabilities;
  }

  /**
   * Get all registered driver metadata
   * @returns Array of all driver metadata, sorted by display name
   */
  static getAvailableDrivers(): DriverMetadata[] {
    return Array.from(DriverFactory.registry.values())
      .map(reg => reg.metadata)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /**
   * Get drivers filtered by category
   * @param category Database category to filter by
   * @returns Array of driver metadata matching the category
   */
  static getDriversByCategory(category: string): DriverMetadata[] {
    return DriverFactory.getAvailableDrivers()
      .filter(meta => meta.category === category);
  }

  /**
   * Check if a driver type is registered
   * @param type Driver type ID
   * @returns true if the driver is registered
   */
  static isRegistered(type: string): boolean {
    return DriverFactory.registry.has(type);
  }

  /**
   * Get the number of registered drivers
   * @returns Number of registered drivers
   */
  static getRegisteredCount(): number {
    return DriverFactory.registry.size;
  }

  /**
   * Clear all registered drivers (useful for testing)
   */
  static clearRegistry(): void {
    DriverFactory.registry.clear();
  }
}
