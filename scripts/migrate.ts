import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as sql from 'mssql';
import { createDatabaseConfig } from '../src/database/database.config';

async function ensureDatabaseExists(): Promise<void> {
  const baseConfig = createDatabaseConfig();
  const targetDb = baseConfig.database;
  if (!targetDb || targetDb === 'master') {
    return;
  }

  const masterConfig: sql.config = {
    ...baseConfig,
    database: 'master',
  };

  const masterPool = new sql.ConnectionPool(masterConfig);
  try {
    await masterPool.connect();
    const checkRequest = masterPool.request();
    checkRequest.input('dbName', sql.NVarChar, targetDb);
    const result = await checkRequest.query<{ exists: number }>(
      'SELECT DB_ID(@dbName) AS [exists]',
    );
    if (!result.recordset[0]?.exists) {
      console.log(`Database [${targetDb}] does not exist. Creating...`);
      // Database name cannot be parameterized in CREATE DATABASE
      const safeDbName = targetDb.replace(/\]/g, ']]');
      await masterPool.request().query(`CREATE DATABASE [${safeDbName}]`);
      console.log(`Database [${targetDb}] created successfully.`);
    }
  } finally {
    await masterPool.close();
  }
}

async function runMigrations(): Promise<void> {
  await ensureDatabaseExists();

  const config = createDatabaseConfig();
  const pool = new sql.ConnectionPool(config);
  await pool.connect();

  let lockAcquired = false;

  try {
    const lockRequest = pool.request();
    lockRequest.input('Resource', sql.NVarChar, 'schema_migrations_lock');
    lockRequest.input('LockMode', sql.NVarChar, 'Exclusive');
    lockRequest.input('LockTimeout', sql.Int, 30000);
    const lockResult = await lockRequest.query<{ result: number }>(`
      DECLARE @res INT;
      EXEC @res = sp_getapplock @Resource = @Resource, @LockMode = @LockMode, @LockOwner = 'Session', @LockTimeout = @LockTimeout;
      SELECT @res AS result;
    `);

    if (
      lockResult.recordset[0]?.result === 0 ||
      lockResult.recordset[0]?.result === 1
    ) {
      lockAcquired = true;
    } else {
      throw new Error(
        `Failed to acquire migration lock: code ${lockResult.recordset[0]?.result}`,
      );
    }

    await pool.request().query(`
      IF OBJECT_ID('schema_migrations', 'U') IS NULL
      BEGIN
        CREATE TABLE schema_migrations (
          name NVARCHAR(255) PRIMARY KEY,
          applied_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME()
        );
      END;
    `);

    const migrationDirectory = join(process.cwd(), 'db', 'migrations');
    const migrationNames = (await readdir(migrationDirectory))
      .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
      .sort();

    for (const name of migrationNames) {
      const checkReq = pool.request();
      checkReq.input('name', sql.NVarChar, name);
      const applied = await checkReq.query(
        'SELECT 1 FROM schema_migrations WHERE name = @name',
      );

      if (applied.recordset && applied.recordset.length > 0) {
        console.log(`Already applied: ${name}`);
        continue;
      }

      const fileContent = await readFile(
        join(migrationDirectory, name),
        'utf8',
      );

      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      try {
        // Split by GO if present, otherwise run as whole batch
        const batches = fileContent
          .split(/^\s*GO\s*$/gim)
          .map((b) => b.trim())
          .filter(Boolean);

        for (const batch of batches) {
          const req = new sql.Request(transaction);
          await req.query(batch);
        }

        const insertReq = new sql.Request(transaction);
        insertReq.input('name', sql.NVarChar, name);
        await insertReq.query(
          'INSERT INTO schema_migrations (name) VALUES (@name)',
        );

        await transaction.commit();
        console.log(`Applied: ${name}`);
      } catch (error) {
        console.error(`Error applying migration ${name}:`, error instanceof Error ? error.message : error);
        try {
          await transaction.rollback();
        } catch {
          // ignore rollback error
        }
        throw error;
      }
    }
  } finally {
    if (lockAcquired) {
      try {
        const unlockReq = pool.request();
        unlockReq.input('Resource', sql.NVarChar, 'schema_migrations_lock');
        await unlockReq.query(`
          EXEC sp_releaseapplock @Resource = @Resource, @LockOwner = 'Session';
        `);
      } catch {
        // ignore unlock error on teardown
      }
    }
    await pool.close();
  }
}

runMigrations().catch((error: unknown) => {
  console.error('Database migration failed.');
  console.error(error instanceof Error ? error.stack : 'Unknown error');
  process.exitCode = 1;
});
