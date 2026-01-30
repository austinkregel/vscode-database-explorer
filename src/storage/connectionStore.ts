import * as vscode from 'vscode';
import { ConnectionConfig } from '../types';

const CONNECTIONS_KEY = 'database-explorer.connections';

export class ConnectionStore {
  private context: vscode.ExtensionContext;
  private connections: Map<string, ConnectionConfig> = new Map();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadConnections();
  }

  private loadConnections(): void {
    const stored = this.context.globalState.get<ConnectionConfig[]>(CONNECTIONS_KEY, []);
    this.connections.clear();
    for (const conn of stored) {
      this.connections.set(conn.id, conn);
    }
  }

  private async saveConnections(): Promise<void> {
    const connectionsArray = Array.from(this.connections.values());
    await this.context.globalState.update(CONNECTIONS_KEY, connectionsArray);
  }

  async addConnection(config: ConnectionConfig): Promise<void> {
    this.connections.set(config.id, config);
    await this.saveConnections();
  }

  async updateConnection(config: ConnectionConfig): Promise<void> {
    if (this.connections.has(config.id)) {
      this.connections.set(config.id, config);
      await this.saveConnections();
    }
  }

  async removeConnection(id: string): Promise<void> {
    this.connections.delete(id);
    await this.deletePassword(id);
    await this.saveConnections();
  }

  async getConnection(id: string): Promise<ConnectionConfig | undefined> {
    return this.connections.get(id);
  }

  getConnectionSync(id: string): ConnectionConfig | undefined {
    return this.connections.get(id);
  }

  getAllConnections(): ConnectionConfig[] {
    return Array.from(this.connections.values());
  }

  // Password management using SecretStorage
  async savePassword(connectionId: string, password: string): Promise<void> {
    const key = `database-explorer.password.${connectionId}`;
    await this.context.secrets.store(key, password);
  }

  async getPassword(connectionId: string): Promise<string | undefined> {
    const key = `database-explorer.password.${connectionId}`;
    return await this.context.secrets.get(key);
  }

  async deletePassword(connectionId: string): Promise<void> {
    const key = `database-explorer.password.${connectionId}`;
    await this.context.secrets.delete(key);
  }
}
