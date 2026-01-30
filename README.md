# Database Explorer

A powerful VS Code extension for exploring and managing databases, inspired by JetBrains DataGrip.

![VS Code Version](https://img.shields.io/badge/VS%20Code-1.105%2B-blue)
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

### Security & Connectivity
- **Secure credential storage** - Passwords stored using VS Code's SecretStorage API
- **SSH tunneling** - Connect through bastion hosts with SSH key or password authentication
- **Read/write replicas** - Route queries to appropriate database replicas
- **Read-only mode** - Protect production databases from accidental writes

### User Experience
- **Status bar integration** - Quickly reopen your last viewed table
- **Context menus** - Right-click actions adapt to database capabilities
- **Export to CSV** - Export query results for external analysis

## Getting Started

1. Open the Database Explorer view from the Activity Bar (database icon)
2. Click the **+** button to add a new connection
3. Select your database type and enter connection details
4. Right-click the connection and select **Connect**
5. Browse schemas, tables, and columns in the tree view
6. Right-click a table or connection to open a query panel

## Commands

| Command | Description |
|---------|-------------|
| `Database Explorer: Add Connection` | Create a new database connection |
| `Database Explorer: Edit Connection` | Modify an existing connection |
| `Database Explorer: Remove Connection` | Delete a connection |
| `Database Explorer: Connect` | Connect to a database |
| `Database Explorer: Disconnect` | Disconnect from a database |
| `Database Explorer: New Query` | Open a SQL query panel |
| `Database Explorer: Refresh` | Refresh the explorer tree |
| `Database Explorer: Reopen Last Viewed Table` | Reopen the last table from status bar |
| `Database Explorer: Open Settings` | Open extension settings (gear icon in panel) |

## Query Panel

- Write SQL queries in the editor area
- Press `Ctrl+Enter` to execute the query
- Double-click a cell to edit its value
- Click **Add Row** to insert a new record
- Click **Delete** on any row to remove it

## Supported Databases

### Relational / SQL Databases

| Database | Features |
|----------|----------|
| **PostgreSQL** | Full SQL support, schemas, views, transactions |
| **MySQL / MariaDB** | Full SQL support, databases as schemas |
| **SQLite** | File-based, no external server required |
| **Microsoft SQL Server** | Full SQL support, OUTPUT clause for CRUD |

### NoSQL Databases

| Database | Features |
|----------|----------|
| **MongoDB** | Collections, documents, aggregation pipeline |

### Time-Series Databases

| Database | Features |
|----------|----------|
| **InfluxDB** | Flux queries, measurements, tags/fields |
| **Prometheus** | PromQL queries, metrics, labels (read-only) |

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

## Settings

Click the **gear icon** in the Database Explorer panel header, or use the command palette to open settings.

| Setting | Default | Description |
|---------|---------|-------------|
| `databaseExplorer.defaultRowLimit` | 100 | Default number of rows to fetch when previewing |
| `databaseExplorer.confirmDestructiveOperations` | true | Show confirmation for DROP/TRUNCATE/DELETE |
| `databaseExplorer.autoConnect` | false | Auto-connect when expanding a connection |
| `databaseExplorer.queryTimeout` | 30000 | Query timeout in milliseconds |
| `databaseExplorer.showStatusBarItem` | true | Show last viewed table in status bar |
| `databaseExplorer.defaultExportFormat` | csv | Export format: csv, json, or sql |
| `databaseExplorer.editor.fontSize` | 14 | Query editor font size |
| `databaseExplorer.editor.wordWrap` | true | Enable word wrap in query editor |
| `databaseExplorer.connections.showSchemaInTree` | true | Show schema names in tree view |
| `databaseExplorer.connections.sortTablesAlphabetically` | true | Sort tables alphabetically |

## Development

```bash
# Install dependencies
npm install

# Compile the extension
npm run compile

# Watch for changes
npm run watch

# Package for distribution
npm run package
```

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
- **Externalized in webpack** - Not bundled into the main extension.js
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

## Requirements

- VS Code 1.108.1 or higher
- Node.js 18 or higher (for development)

## Known Limitations

- CRUD operations require a detectable primary key (defaults to `id` column for SQL, `_id` for MongoDB)
- Complex queries with JOINs may not support inline editing
- SQLite changes are saved on disconnect
- NoSQL query syntax varies by database (MongoDB uses JSON, InfluxDB uses Flux)
- Time-series databases have limited CRUD support (Prometheus is read-only)

## Documentation

- [Driver Architecture](docs/DRIVER_ARCHITECTURE.md) - How the plugin system works and how to add new drivers
- [Changelog](CHANGELOG.md) - Version history and release notes

## License

MIT
