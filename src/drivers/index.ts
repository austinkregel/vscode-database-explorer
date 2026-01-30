/**
 * Driver Index - Barrel export that imports all drivers
 * 
 * Importing this file triggers driver self-registration with the DriverFactory.
 * All driver types will be available after this import.
 */

// Core driver infrastructure
export { DriverFactory } from './driverFactory';
export { BaseDbDriver } from './baseDriver';
export * from './capabilities';

// SQL Drivers
export { PostgresDriver, postgresMetadata } from './postgresDriver';
export { MySqlDriver, mysqlMetadata } from './mysqlDriver';
export { SqliteDriver, sqliteMetadata } from './sqliteDriver';
export { MssqlDriver, mssqlMetadata } from './mssqlDriver';

// NoSQL Drivers
export { MongoDriver, mongoMetadata } from './mongoDriver';

// Time-Series Drivers
export { InfluxDbDriver, influxdbMetadata } from './influxdbDriver';
export { PrometheusDriver, prometheusMetadata } from './prometheusDriver';
