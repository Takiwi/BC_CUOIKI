import { createDatabaseConfig } from './database.config';

describe('createDatabaseConfig', () => {
  it('builds a bounded MSSQL pool from discrete environment variables', () => {
    expect(
      createDatabaseConfig({
        MSSQL_HOST: '127.0.0.1',
        MSSQL_PORT: '1433',
        MSSQL_USER: 'club_test',
        MSSQL_PASSWORD: 'test-only-password',
        MSSQL_DATABASE: 'club_test',
      }),
    ).toMatchObject({
      server: '127.0.0.1',
      port: 1433,
      user: 'club_test',
      password: 'test-only-password',
      database: 'club_test',
      pool: {
        max: 10,
      },
      connectionTimeout: 5000,
    });
  });

  it('uses DATABASE_URL when provided', () => {
    expect(
      createDatabaseConfig({
        DATABASE_URL: 'sqlserver://user:password@localhost:1433/club_test',
      }),
    ).toMatchObject({
      server: 'localhost',
      port: 1433,
      user: 'user',
      password: 'password',
      database: 'club_test',
      pool: {
        max: 10,
      },
    });
  });

  it('rejects missing credentials and invalid ports', () => {
    expect(() => createDatabaseConfig({ MSSQL_USER: 'club_test' })).toThrow(
      'Set DATABASE_URL or MSSQL_USER, MSSQL_PASSWORD, and MSSQL_DATABASE',
    );
    expect(() =>
      createDatabaseConfig({
        MSSQL_HOST: 'localhost',
        MSSQL_PORT: 'not-a-port',
        MSSQL_USER: 'club_test',
        MSSQL_PASSWORD: 'test-only-password',
        MSSQL_DATABASE: 'club_test',
      }),
    ).toThrow('MSSQL_PORT must be a valid TCP port');
  });
});
