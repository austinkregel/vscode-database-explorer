# Database Explorer

A powerful VS Code extension for exploring and managing databases, inspired by JetBrains DataGrip.

![VS Code Version](https://img.shields.io/badge/VS%20Code-1.108%2B-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Databases](https://img.shields.io/badge/databases-7%2B-orange)

## Features

### Core Functionality
- **Multi-database support** - Connect to SQL, NoSQL, and time-series databases
- **Plugin-based architecture** - Easily extensible to support new database types
- **Tree-based schema browser** - Navigate connections → schemas → tables → columns
- **SQL query editor** - Write and execute queries with keyboard shortcuts (Ctrl+Enter)
- **Results grid** - View query results in a sortable, scrollable table
- **Inline row editing** - Double-click cells to edit values directly
- **CRUD operations** - Insert, update, and delete rows from the query panel
- **DDL viewer** - View CREATE statements for tables and views

### Security & Connectivity
- **Secure credential storage** - Passwords stored using VS Code's SecretStorage API
- **SSH tunneling** - Connect through bastion hosts with SSH key or password authentication
- **Read/write replicas** - Route queries to appropriate database replicas
- **Read-only mode** - Protect production databases from accidental writes

### User Experience
- **Status bar integration** - Quickly reopen your last viewed table
- **Context menus** - Right-click actions adapt to database capabilities
- **Export to CSV** - Export query results for external analysis
- **Copy utilities** - Copy table names, qualified names, or column lists
- **Double-click navigation** - Double-click tables to open with data, connections to connect

## Getting Started

1. Open the Database Explorer view from the Activity Bar (database icon)
2. Click the **+** button to add a new connection
3. Select your database type and enter connection details
4. Right-click the connection and select **Connect** (or double-click)
5. Browse schemas, tables, and columns in the tree view
6. Right-click a table to open a query panel, preview data, or view DDL

## Commands

| Command | Description |
|---------|-------------|
| `Database Explorer: Add Connection` | Create a new database connection |
| `Database Explorer: Edit Connection` | Modify an existing connection |
| `Database Explorer: Remove Connection` | Delete a connection |
| `Database Explorer: Connect` | Connect to a database |
| `Database Explorer: Disconnect` | Disconnect from a database |
| `Database Explorer: New Query` | Open a SQL query panel |
| `Database Explorer: Open Query (Limit 250)` | Open query panel with 250-row limit |
| `Database Explorer: Preview Top 100` | Quick preview of first 100 rows |
| `Database Explorer: Show DDL` | View the CREATE statement for a table/view |
| `Database Explorer: Count Rows` | Count total rows in a table |
| `Database Explorer: Export CSV` | Export table data to CSV file |
| `Database Explorer: Copy Table Name` | Copy the table name to clipboard |
| `Database Explorer: Copy Qualified Name` | Copy schema.table name to clipboard |
| `Database Explorer: Copy Column Names` | Copy all column names to clipboard |
| `Database Explorer: Refresh` | Refresh the explorer tree |
| `Database Explorer: Refresh Table` | Refresh a specific table |
| `Database Explorer: Delete Rows (WHERE...)` | Delete rows matching a condition |
| `Database Explorer: Truncate Table` | Remove all rows from a table |
| `Database Explorer: Drop Table` | Permanently delete a table |
| `Database Explorer: Drop View` | Permanently delete a view |
| `Database Explorer: Show Logs` | Open the extension output channel |

## Query Panel

- Write SQL queries in the editor area
- Press `Ctrl+Enter` (or `Cmd+Enter` on macOS) to execute the query
- Double-click a cell to edit its value
- Click **Add Row** to insert a new record
- Click **Delete** on any row to remove it

## Supported Databases

### Relational / SQL Databases

| Database | Driver ID | Default Port | Features |
|----------|-----------|--------------|----------|
| **PostgreSQL** | `postgres` | 5432 | Full SQL support, schemas, views, transactions |
| **MySQL / MariaDB** | `mysql` | 3306 | Full SQL support, databases as schemas |
| **SQLite** | `sqlite` | N/A | File-based, no external server required |
| **Microsoft SQL Server** | `mssql` | 1433 | Full SQL support, OUTPUT clause for CRUD |

### NoSQL Databases

| Database | Driver ID | Default Port | Features |
|----------|-----------|--------------|----------|
| **MongoDB** | `mongodb` | 27017 | Collections, documents, aggregation pipeline |

### Time-Series Databases

| Database | Driver ID | Default Port | Features |
|----------|-----------|--------------|----------|
| **InfluxDB** | `influxdb` | 8086 | Flux queries, measurements, tags/fields |
| **Prometheus** | `prometheus` | 9090 | PromQL queries, metrics, labels (read-only) |

> See [Driver Architecture Documentation](docs/DRIVER_ARCHITECTURE.md) for details on adding support for new databases.

## Advanced Features

### Read-Only Mode

Protect production databases by enabling read-only mode when creating a connection. This blocks all INSERT, UPDATE, DELETE, and DDL operations at the driver level.

### SSH Tunneling

Connect to databases through an SSH bastion host:

1. When adding a connection, expand the **Advanced** section
2. Enable SSH tunnel and enter:
   - SSH host and port
   - Username
   - Authentication method (password, private key, or SSH agent)

### Read/Write Replicas

Route queries to appropriate database replicas for better performance:

- Write operations go to the primary server
- Read operations are load-balanced across replicas
- Supports round-robin, random, and first-available strategies

### Status Bar

The last viewed table appears in the status bar. Click it to quickly reopen the table with your previous query.

## Development

```bash
# Install dependencies
npm install

# Compile the extension (fast, ~150ms with esbuild)
npm run compile

# Watch for changes
npm run watch

# Run linting and type checking
npm run check

# Package for distribution (minified)
npm run package
```

### Build System

The extension uses **esbuild** for fast bundling:

| Build Type | Command | Description |
|------------|---------|-------------|
| Development | `npm run compile` | Fast build with source maps |
| Watch | `npm run watch` | Rebuild on file changes |
| Production | `npm run package` | Minified, no source maps |

### Publishing the Extension

```bash
# Install vsce (VS Code Extension CLI)
npm install -g @vscode/vsce

# Package for distribution (creates .vsix file)
vsce package

# Publish to marketplace (requires publisher account)
vsce publish
```

**Note on Native Dependencies:**

Some database drivers use optional native modules (e.g., MongoDB's Kerberos authentication, compression). These are:
- **Externalized in esbuild** - Not bundled into the main extension.js
- **Included via node_modules** - The `.vscodeignore` is configured to include production dependencies
- **Gracefully handled** - If a driver fails to load, other drivers still work

For cross-platform support, native modules need pre-built binaries for each platform (Windows, macOS, Linux).

### Adding a New Driver

The extension uses a plugin-based architecture. To add support for a new database:

1. Create a new driver file in `src/drivers/`
2. Extend `BaseDbDriver` and implement required methods
3. Define metadata with capabilities and connection fields
4. Call `DriverFactory.register()` to self-register
5. Import the driver in `driverRegistry.ts`

See [Driver Architecture Documentation](docs/DRIVER_ARCHITECTURE.md) for complete details.

### Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run compile` | Build extension with esbuild |
| `npm run watch` | Watch mode with esbuild |
| `npm run package` | Production build (minified) |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run check` | Run both typecheck and lint |
| `npm run check:fix` | Auto-fix ESLint issues |
| `npm test` | Run test suite |

## Requirements

- VS Code 1.108.1 or higher
- Node.js 22.x or higher (for development)

## Known Limitations

- CRUD operations require a detectable primary key (defaults to `id` column for SQL, `_id` for MongoDB)
- Complex queries with JOINs may not support inline editing
- SQLite changes are saved on disconnect
- NoSQL query syntax varies by database (MongoDB uses JSON, InfluxDB uses Flux)
- Time-series databases have limited CRUD support (Prometheus is read-only)

## Project Structure

```
src/
├── extension.ts          # Extension entry point (activate/deactivate)
├── types.ts              # Central type definitions
├── drivers/              # Database driver implementations
│   ├── baseDriver.ts     # Abstract base class for all drivers
│   ├── capabilities.ts   # Driver capability presets
│   ├── driverFactory.ts  # Static factory for driver registration
│   ├── driverRegistry.ts # Manages active driver instances
│   └── *Driver.ts        # Individual driver implementations
├── networking/           # Advanced connection features
│   ├── sshTunnel.ts      # SSH tunnel management
│   ├── replicaRouter.ts  # Read/write replica routing
│   └── connectionWrapper.ts
├── storage/
│   └── connectionStore.ts # Persists connection configs
├── utils/
│   └── logger.ts         # Extension logging
└── views/
    ├── explorerTree.ts   # TreeDataProvider for sidebar
    ├── queryPanel.ts     # WebviewPanel for query execution
    └── statusBar.ts      # Status bar for last viewed table
```

## Documentation

- [Driver Architecture](docs/DRIVER_ARCHITECTURE.md) - How the plugin system works and how to add new drivers
- [Changelog](CHANGELOG.md) - Version history and release notes

## License

MIT
