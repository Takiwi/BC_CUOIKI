import { config as MssqlConfig } from 'mssql';

export function createDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MssqlConfig {
  const connectionString = environment.DATABASE_URL;
  if (connectionString) {
    // If it's a connection string
    try {
      const url = new URL(connectionString);
      const host = url.hostname;
      const port = url.port ? Number(url.port) : 1433;
      const user = decodeURIComponent(url.username);
      const password = decodeURIComponent(url.password);
      const database = url.pathname.replace(/^\//, '');
      const encrypt = url.searchParams.get('encrypt') === 'true';

      return {
        server: host,
        port,
        user,
        password,
        database,
        options: {
          encrypt,
          trustServerCertificate: true,
          enableArithAbort: true,
        },
        pool: {
          max: 10,
          idleTimeoutMillis: 30_000,
        },
        connectionTimeout: 5_000,
      };
    } catch {
      // If parsing as URL fails, fallback to discrete or throw
    }
  }

  const user = environment.MSSQL_USER ?? environment.PGUSER;
  const password = environment.MSSQL_PASSWORD ?? environment.PGPASSWORD;
  const database = environment.MSSQL_DATABASE ?? environment.PGDATABASE;

  if (!user || !password || !database) {
    throw new Error(
      'Set DATABASE_URL or MSSQL_USER, MSSQL_PASSWORD, and MSSQL_DATABASE in the environment.',
    );
  }

  const portRaw = environment.MSSQL_PORT ?? environment.PGPORT ?? 1433;
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MSSQL_PORT must be a valid TCP port.');
  }

  const server = environment.MSSQL_HOST ?? environment.PGHOST ?? '127.0.0.1';
  const encrypt = environment.MSSQL_ENCRYPT === 'true';

  return {
    server,
    port,
    user,
    password,
    database,
    options: {
      encrypt,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    pool: {
      max: 10,
      idleTimeoutMillis: 30_000,
    },
    connectionTimeout: 5_000,
  };
}

// Alias for backwards compatibility if needed
export const createPoolConfig = createDatabaseConfig;
