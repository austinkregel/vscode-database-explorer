import { ConnectionConfig, DbDriver } from '../types';
import { DriverFactory } from '../drivers/driverFactory';
import { SSHTunnel, createTunnelIfNeeded } from './sshTunnel';
import { ReplicaRouter, createReplicaRouterIfNeeded } from './replicaRouter';

/**
 * Connection Wrapper
 * 
 * Wraps a database driver with optional SSH tunnel and replica routing support.
 * This provides a unified interface for connecting to databases with advanced
 * networking configurations.
 */
export class ConnectionWrapper {
  private config: ConnectionConfig;
  private password: string;
  private sshPassword?: string;
  
  private tunnel: SSHTunnel | null = null;
  private replicaRouter: ReplicaRouter | null = null;
  private driver: DbDriver | null = null;

  constructor(config: ConnectionConfig, password: string, sshPassword?: string) {
    this.config = config;
    this.password = password;
    this.sshPassword = sshPassword;
  }

  /**
   * Connect to the database, setting up tunnel and replicas as needed
   */
  async connect(): Promise<DbDriver> {
    // If replica routing is enabled, use the replica router
    if (this.config.replicaConfig?.enabled) {
      this.replicaRouter = createReplicaRouterIfNeeded(this.config, this.password);
      if (this.replicaRouter) {
        await this.replicaRouter.connect();
        // Return the write driver as the primary driver for metadata operations
        return this.replicaRouter.getWriteDriver();
      }
    }

    // Set up SSH tunnel if configured
    let connectHost = this.config.host || 'localhost';
    let connectPort = this.config.port || 5432;

    if (this.config.proxyConfig?.type === 'ssh') {
      const tunnelResult = await createTunnelIfNeeded(
        this.config.proxyConfig,
        connectHost,
        connectPort,
        this.sshPassword
      );
      this.tunnel = tunnelResult.tunnel;
      connectHost = tunnelResult.host;
      connectPort = tunnelResult.port;
    }

    // Create the driver with potentially modified connection details
    const effectiveConfig: ConnectionConfig = {
      ...this.config,
      host: connectHost,
      port: connectPort
    };

    this.driver = DriverFactory.create(this.config.type, effectiveConfig, this.password);
    await this.driver.connect();

    return this.driver;
  }

  /**
   * Disconnect from the database and clean up tunnel/replicas
   */
  async disconnect(): Promise<void> {
    // Disconnect replica router if used
    if (this.replicaRouter) {
      await this.replicaRouter.disconnect();
      this.replicaRouter = null;
    }

    // Disconnect driver if used
    if (this.driver) {
      await this.driver.disconnect();
      this.driver = null;
    }

    // Close SSH tunnel if used
    if (this.tunnel) {
      await this.tunnel.disconnect();
      this.tunnel = null;
    }
  }

  /**
   * Get the active driver
   */
  getDriver(): DbDriver | null {
    if (this.replicaRouter) {
      return this.replicaRouter.getWriteDriver();
    }
    return this.driver;
  }

  /**
   * Get the read driver (for read replica routing)
   */
  getReadDriver(): DbDriver | null {
    if (this.replicaRouter) {
      return this.replicaRouter.getReadDriver();
    }
    return this.driver;
  }

  /**
   * Get the replica router if configured
   */
  getReplicaRouter(): ReplicaRouter | null {
    return this.replicaRouter;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    if (this.replicaRouter) {
      return this.replicaRouter.isConnected();
    }
    return this.driver?.isConnected() ?? false;
  }

  /**
   * Check if using SSH tunnel
   */
  isUsingTunnel(): boolean {
    return this.tunnel !== null && this.tunnel.isConnected();
  }

  /**
   * Check if using replica routing
   */
  isUsingReplicas(): boolean {
    return this.replicaRouter !== null;
  }
}

/**
 * Create a connection wrapper for advanced connection scenarios
 */
export function createConnectionWrapper(
  config: ConnectionConfig,
  password: string,
  sshPassword?: string
): ConnectionWrapper {
  return new ConnectionWrapper(config, password, sshPassword);
}
