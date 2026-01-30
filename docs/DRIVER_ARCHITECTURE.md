# Database Explorer - Driver Architecture

This document describes the plugin-based driver architecture that allows the Database Explorer to support multiple database types including SQL, NoSQL, and time-series databases.

## Table of Contents

- [Overview](#overview)
- [Supported Databases](#supported-databases)
- [Architecture](#architecture)
- [Driver Capabilities](#driver-capabilities)
- [Adding a New Driver](#adding-a-new-driver)
- [Advanced Networking](#advanced-networking)
- [Status Bar Integration](#status-bar-integration)

## Overview

The Database Explorer uses a plugin-style architecture where each database driver:

1. **Self-registers** with the `DriverFactory` at module load time
2. **Declares its capabilities** through a `DriverCapabilities` interface
3. **Provides metadata** for UI generation (connection fields, icons, categories)
4. **Extends a base class** that provides common functionality like read-only mode enforcement

This design allows new database types to be added without modifying the core extension code.

## Supported Databases

### Relational/SQL Databases

| Database | Driver ID | Default Port | Features |
|----------|-----------|--------------|----------|
| PostgreSQL | `postgres` | 5432 | Full SQL, schemas, views, transactions |
| MySQL/MariaDB | `mysql` | 3306 | Full SQL, databases as schemas |
| SQLite | `sqlite` | N/A | File-based, no schemas |
| Microsoft SQL Server | `mssql` | 1433 | Full SQL, OUTPUT clause support |

### NoSQL Databases

| Database | Driver ID | Default Port | Features |
|----------|-----------|--------------|----------|
| MongoDB | `mongodb` | 27017 | Collections, documents, aggregation |

### Time-Series Databases

| Database | Driver ID | Default Port | Features |
|----------|-----------|--------------|----------|
| InfluxDB | `influxdb` | 8086 | Flux queries, measurements, tags/fields |
| Prometheus | `prometheus` | 9090 | PromQL, metrics, labels (read-only) |

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Extension                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ TreeView    │  │ QueryPanel  │  │ StatusBar               │  │
│  │ (Explorer)  │  │ (WebView)   │  │ (Last Viewed Table)     │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│         │                │                      │                │
│         └────────────────┼──────────────────────┘                │
│                          ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    DriverRegistry                          │  │
│  │  - Manages active connections                              │  │
│  │  - Delegates to DriverFactory                              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    DriverFactory                           │  │
│  │  - Static registry of all drivers                          │  │
│  │  - Creates driver instances                                │  │
│  │  - Provides metadata lookup                                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                          │                                       │
│         ┌────────────────┼────────────────┐                      │
│         ▼                ▼                ▼                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ PostgreSQL  │  │  MongoDB    │  │  InfluxDB   │  ...         │
│  │   Driver    │  │   Driver    │  │   Driver    │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│         │                │                │                      │
│         └────────────────┼────────────────┘                      │
│                          ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    BaseDbDriver                            │  │
│  │  - Read-only mode enforcement                              │  │
│  │  - Default method implementations                          │  │
│  │  - Connection state management                             │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `src/types.ts` | Type definitions for drivers, capabilities, and configurations |
| `src/drivers/driverFactory.ts` | Static factory with driver registration |
| `src/drivers/baseDriver.ts` | Abstract base class for all drivers |
| `src/drivers/capabilities.ts` | Capability presets and helper functions |
| `src/drivers/driverRegistry.ts` | Manages active driver instances |
| `src/drivers/index.ts` | Barrel export that triggers driver registration |

## Driver Capabilities

Each driver declares its capabilities through the `DriverCapabilities` interface:

```typescript
interface DriverCapabilities {
  // Data Structure
  supportsSchemas: boolean;      // PostgreSQL: true, SQLite: false
  supportsTables: boolean;       // SQL databases: true, Redis: false
  supportsViews: boolean;        // Most SQL: true, MongoDB: false
  supportsCollections: boolean;  // MongoDB: true, SQL: false
  supportsMeasurements: boolean; // InfluxDB: true, others: false
  
  // Query Languages
  supportsSQL: boolean;          // SQL databases: true
  supportsNoSQLQueries: boolean; // MongoDB: true
  supportsFlux: boolean;         // InfluxDB 2.x: true
  supportsPromQL: boolean;       // Prometheus: true
  
  // CRUD Operations
  supportsInsert: boolean;       // Most: true, Prometheus: false
  supportsUpdate: boolean;       // SQL/Mongo: true, InfluxDB: false
  supportsDelete: boolean;       // Most: true
  supportsTruncate: boolean;     // SQL: true, NoSQL: varies
  supportsDDL: boolean;          // SQL: true, Prometheus: false
  
  // Advanced Features
  supportsTransactions: boolean;
  supportsPrimaryKeys: boolean;
  supportsExport: boolean;
  supportsRowEditing: boolean;
  
  // Tree Structure
  treeStructure: TreeStructureType;
}
```

### Tree Structure Types

Different databases organize their data differently:

| Type | Used By | Structure |
|------|---------|-----------|
| `schema-table-column` | PostgreSQL, MySQL, MSSQL | Schema → Tables/Views → Columns |
| `database-table-column` | SQLite | Database → Tables/Views → Columns |
| `database-collection` | MongoDB | Database → Collections |
| `bucket-measurement` | InfluxDB | Bucket → Measurements → Fields/Tags |
| `metric-label` | Prometheus | Metrics → Labels |
| `keyspace` | Redis | Keyspaces → Keys |

### Capability-Based UI

The extension uses capabilities to:

1. **Show/hide context menu items** - Destructive operations only appear when supported
2. **Enable/disable features** - Row editing disabled for read-only drivers
3. **Select query editor** - SQL editor vs PromQL editor vs Flux editor
4. **Render tree structure** - Different hierarchies for different database types

## Adding a New Driver

### Step 1: Create the Driver File

Create a new file `src/drivers/myDriver.ts`:

```typescript
import { DriverMetadata, ConnectionConfig, QueryResult } from '../types';
import { BaseDbDriver } from './baseDriver';
import { SQL_FULL_CAPABILITIES } from './capabilities';
import { DriverFactory } from './driverFactory';

// 1. Define metadata
export const myDriverMetadata: DriverMetadata = {
  id: 'mydb',
  displayName: 'My Database',
  icon: '$(database)',
  category: 'relational',
  defaultPort: 5000,
  capabilities: {
    ...SQL_FULL_CAPABILITIES,
    // Override specific capabilities
    supportsTransactions: false
  },
  connectionFields: [
    { key: 'host', label: 'Host', type: 'text', required: true, group: 'basic' },
    { key: 'port', label: 'Port', type: 'number', required: true, defaultValue: 5000, group: 'basic' },
    { key: 'database', label: 'Database', type: 'text', required: true, group: 'basic' },
    { key: 'username', label: 'Username', type: 'text', required: true, group: 'basic' },
    { key: 'password', label: 'Password', type: 'password', required: false, group: 'basic' },
    { key: 'readOnly', label: 'Read-only', type: 'checkbox', required: false, group: 'advanced' }
  ]
};

// 2. Implement the driver
export class MyDriver extends BaseDbDriver {
  private client: MyDbClient | null = null;

  constructor(config: ConnectionConfig, password: string = '') {
    super(config, password);
  }

  getMetadata(): DriverMetadata {
    return myDriverMetadata;
  }

  async connect(): Promise<void> {
    this.client = new MyDbClient({
      host: this.config.host,
      port: this.config.port,
      // ...
    });
    await this.client.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this.connected = false;
  }

  override async executeQuery(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.client) throw new Error('Not connected');
    
    // Validate read-only mode
    this.validateQuery(sql);
    
    const result = await this.client.query(sql, params);
    return {
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rows.length
    };
  }

  // Implement other methods as needed...
}

// 3. Register with the factory
DriverFactory.register(myDriverMetadata, MyDriver);
```

### Step 2: Import the Driver

Add the import to `src/drivers/driverRegistry.ts`:

```typescript
// Import all drivers to trigger their self-registration
import './postgresDriver';
import './mysqlDriver';
// ... other drivers ...
import './myDriver';  // Add this line
```

### Step 3: Export from Index (Optional)

Add to `src/drivers/index.ts` for external access:

```typescript
export { MyDriver, myDriverMetadata } from './myDriver';
```

### Step 4: Add Dependencies

Add any required npm packages to `package.json`:

```json
{
  "dependencies": {
    "my-db-client": "^1.0.0"
  }
}
```

That's it! The driver will automatically appear in the "Add Connection" dialog.

## Advanced Networking

### Read-Only Mode

Any connection can be set to read-only mode:

```typescript
const config: ConnectionConfig = {
  // ... connection details ...
  readOnly: true  // Blocks all write operations
};
```

The `BaseDbDriver` enforces read-only mode by:
- Checking `this.config.readOnly` before write operations
- Parsing SQL to detect write queries (INSERT, UPDATE, DELETE, etc.)

### SSH Tunneling

Connect through an SSH bastion host:

```typescript
const config: ConnectionConfig = {
  // ... connection details ...
  proxyConfig: {
    type: 'ssh',
    sshHost: 'bastion.example.com',
    sshPort: 22,
    sshUsername: 'admin',
    sshAuthMethod: 'privateKey',
    sshPrivateKeyPath: '~/.ssh/id_rsa'
  }
};
```

Supported authentication methods:
- `password` - SSH password (stored in SecretStorage)
- `privateKey` - SSH private key file
- `agent` - SSH agent (uses `SSH_AUTH_SOCK`)

### Read/Write Replicas

Route queries to appropriate replicas:

```typescript
const config: ConnectionConfig = {
  // ... base connection details ...
  replicaConfig: {
    enabled: true,
    writeHost: 'primary.example.com',
    writePort: 5432,
    readHosts: [
      { host: 'replica1.example.com', port: 5432, weight: 1 },
      { host: 'replica2.example.com', port: 5432, weight: 2 }
    ],
    loadBalancing: 'round-robin'  // or 'random', 'first-available'
  }
};
```

## Status Bar Integration

The extension displays the last viewed table in the VS Code status bar:

```
┌─────────────────────────────────────────────────────────────┐
│ 📋 public.users                              Ln 1, Col 1    │
└─────────────────────────────────────────────────────────────┘
   ↑ Light blue, clickable
```

Features:
- **Persistence** - Survives VS Code restarts (stored in workspace state)
- **Click to reopen** - Re-executes the last query for that table
- **Tooltip** - Shows connection name and full query

The status bar is implemented in `src/views/statusBar.ts`.

## Configuration Reference

### ConnectionConfig

```typescript
interface ConnectionConfig {
  id: string;              // Unique connection ID
  name: string;            // Display name
  type: string;            // Driver ID (e.g., 'postgres', 'mongodb')
  
  // Common fields
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  
  // SQLite specific
  filepath?: string;
  
  // Connection mode
  readOnly?: boolean;
  
  // Advanced networking
  replicaConfig?: ReplicaConfig;
  proxyConfig?: ProxyConfig;
  
  // Driver-specific fields
  [key: string]: unknown;
}
```

### ConnectionField

Used to define the connection form UI:

```typescript
interface ConnectionField {
  key: string;           // Config property name
  label: string;         // Display label
  type: 'text' | 'password' | 'number' | 'file' | 'select' | 'checkbox';
  required: boolean;
  placeholder?: string;
  defaultValue?: string | number | boolean;
  options?: { value: string; label: string }[];  // For select type
  group?: 'basic' | 'advanced' | 'ssh' | 'replica';
}
```

## Troubleshooting

### Driver Not Appearing

1. Ensure the driver file is imported in `driverRegistry.ts`
2. Verify `DriverFactory.register()` is called at the module level
3. Check the console for registration errors

### Connection Failures

1. Verify network connectivity to the database
2. Check if SSH tunnel is required for remote databases
3. Ensure credentials are correct
4. For SSL/TLS issues, check driver-specific options

### Read-Only Mode Not Working

1. Verify `readOnly: true` is set in the connection config
2. Check that write operations call `this.assertWriteAllowed()`
3. Ensure `this.validateQuery(sql)` is called in `executeQuery()`

## Contributing

When adding a new driver:

1. Follow the existing driver patterns
2. Use the appropriate capability preset from `capabilities.ts`
3. Implement all required `DbDriver` interface methods
4. Add proper error handling
5. Include TypeScript types for any external libraries
6. Update this documentation
