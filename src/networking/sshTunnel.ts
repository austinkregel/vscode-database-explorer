import { Client, ConnectConfig, ClientChannel } from 'ssh2';
import * as net from 'net';
import * as fs from 'fs';
import { ProxyConfig } from '../types';

/**
 * SSH Tunnel Manager
 * 
 * Creates an SSH tunnel to forward local connections to a remote database server.
 * This allows connecting to databases that are only accessible through an SSH bastion host.
 */
export class SSHTunnel {
  private client: Client | null = null;
  private server: net.Server | null = null;
  private localPort: number = 0;
  private connected: boolean = false;

  /**
   * Establish an SSH tunnel
   * 
   * @param config Proxy configuration containing SSH connection details
   * @param targetHost The database host to connect to (from the SSH server's perspective)
   * @param targetPort The database port to connect to
   * @param password Optional SSH password (retrieved from SecretStorage)
   * @returns The local port to connect to
   */
  async connect(
    config: ProxyConfig,
    targetHost: string,
    targetPort: number,
    password?: string
  ): Promise<number> {
    if (this.connected) {
      return this.localPort;
    }

    return new Promise((resolve, reject) => {
      this.client = new Client();

      // Build SSH connection config
      const sshConfig: ConnectConfig = {
        host: config.sshHost,
        port: config.sshPort || 22,
        username: config.sshUsername
      };

      // Configure authentication method
      switch (config.sshAuthMethod) {
        case 'password':
          sshConfig.password = password;
          break;
        case 'privateKey':
          if (config.sshPrivateKeyPath) {
            try {
              sshConfig.privateKey = fs.readFileSync(config.sshPrivateKeyPath);
            } catch (err) {
              reject(new Error(`Failed to read SSH private key: ${config.sshPrivateKeyPath}`));
              return;
            }
          }
          break;
        case 'agent':
          sshConfig.agent = process.env.SSH_AUTH_SOCK;
          break;
        default:
          // Try password if available, otherwise agent
          if (password) {
            sshConfig.password = password;
          } else {
            sshConfig.agent = process.env.SSH_AUTH_SOCK;
          }
      }

      this.client.on('ready', () => {
        // Create local server to accept connections
        this.server = net.createServer((socket) => {
          this.client!.forwardOut(
            socket.remoteAddress || '127.0.0.1',
            socket.remotePort || 0,
            targetHost,
            targetPort,
            (err: Error | undefined, stream: ClientChannel) => {
              if (err) {
                socket.end();
                return;
              }
              socket.pipe(stream).pipe(socket);
            }
          );
        });

        // Listen on a random available port
        this.server.listen(0, '127.0.0.1', () => {
          const address = this.server!.address();
          if (typeof address === 'object' && address !== null) {
            this.localPort = address.port;
            this.connected = true;
            resolve(this.localPort);
          } else {
            reject(new Error('Failed to get local server address'));
          }
        });

        this.server.on('error', (err) => {
          reject(new Error(`SSH tunnel server error: ${err.message}`));
        });
      });

      this.client.on('error', (err: Error) => {
        reject(new Error(`SSH connection error: ${err.message}`));
      });

      this.client.on('close', () => {
        this.connected = false;
      });

      // Connect to SSH server
      this.client.connect(sshConfig);
    });
  }

  /**
   * Close the SSH tunnel
   */
  async disconnect(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    if (this.client) {
      this.client.end();
      this.client = null;
    }

    this.connected = false;
    this.localPort = 0;
  }

  /**
   * Check if the tunnel is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the local port to connect to
   */
  getLocalPort(): number {
    return this.localPort;
  }
}

/**
 * Factory function to create an SSH tunnel if proxy config is present
 */
export async function createTunnelIfNeeded(
  proxyConfig: ProxyConfig | undefined,
  targetHost: string,
  targetPort: number,
  password?: string
): Promise<{ tunnel: SSHTunnel | null; host: string; port: number }> {
  if (!proxyConfig || proxyConfig.type !== 'ssh') {
    return { tunnel: null, host: targetHost, port: targetPort };
  }

  const tunnel = new SSHTunnel();
  const localPort = await tunnel.connect(proxyConfig, targetHost, targetPort, password);

  return {
    tunnel,
    host: '127.0.0.1',
    port: localPort
  };
}
