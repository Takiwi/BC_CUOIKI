import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as sql from 'mssql';
import { createDatabaseConfig } from './database.config';

export type QueryResultRow = Record<string, any>;

export interface QueryResult<Row extends QueryResultRow = QueryResultRow> {
  rows: Row[];
  rowCount: number;
}

export interface DatabaseClient {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
  executeProcedure<Row extends QueryResultRow = QueryResultRow>(
    procedureName: string,
    params?: Record<string, unknown>,
  ): Promise<QueryResult<Row>>;
}

// Alias for backwards compatibility with existing codebase
export type PoolClient = DatabaseClient;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool!: sql.ConnectionPool;

  async onModuleInit(): Promise<void> {
    const config = createDatabaseConfig();
    this.pool = new sql.ConnectionPool(config);
    this.pool.on('error', (error: Error) => {
      this.logger.error('Unexpected idle MSSQL client error', error.stack);
    });

    await this.pool.connect();
    await this.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
    }
  }

  getPool(): sql.ConnectionPool {
    return this.pool;
  }

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return this.executeQuery<Row>(text, values, this.pool);
  }

  executeProcedure<Row extends QueryResultRow = QueryResultRow>(
    procedureName: string,
    params: Record<string, unknown> = {},
  ): Promise<QueryResult<Row>> {
    return this.runProcedure<Row>(procedureName, params, this.pool);
  }

  async transaction<Result>(
    callback: (client: DatabaseClient) => Promise<Result>,
  ): Promise<Result> {
    const transaction = new sql.Transaction(this.pool);
    await transaction.begin();

    const client: DatabaseClient = {
      query: <Row extends QueryResultRow = QueryResultRow>(
        text: string,
        values: unknown[] = [],
      ): Promise<QueryResult<Row>> => {
        return this.executeQuery<Row>(text, values, transaction);
      },
      executeProcedure: <Row extends QueryResultRow = QueryResultRow>(
        procedureName: string,
        params: Record<string, unknown> = {},
      ): Promise<QueryResult<Row>> => {
        return this.runProcedure<Row>(procedureName, params, transaction);
      },
    };

    try {
      const result = await callback(client);
      await transaction.commit();
      return result;
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        this.logger.error(
          'Failed to roll back MSSQL transaction',
          rollbackError instanceof Error ? rollbackError.stack : undefined,
        );
      }
      throw error;
    }
  }

  private async executeQuery<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
    runner: sql.ConnectionPool | sql.Transaction,
  ): Promise<QueryResult<Row>> {
    const request =
      runner instanceof sql.Transaction
        ? new sql.Request(runner)
        : new sql.Request(runner);

    // Replace $1, $2, ... placeholders with @p1, @p2, ...
    const transformedText = text.replace(/\$(\d+)/g, '@p$1');

    for (let i = 0; i < values.length; i++) {
      const val = values[i];
      const paramName = `p${i + 1}`;
      if (val === undefined || val === null) {
        request.input(paramName, sql.NVarChar, null);
      } else if (typeof val === 'boolean') {
        request.input(paramName, sql.Bit, val ? 1 : 0);
      } else if (typeof val === 'number') {
        if (Number.isInteger(val)) {
          request.input(paramName, sql.Int, val);
        } else {
          request.input(paramName, sql.Float, val);
        }
      } else if (val instanceof Date) {
        request.input(paramName, sql.DateTimeOffset, val);
      } else if (typeof val === 'string') {
        request.input(paramName, sql.NVarChar, val);
      } else {
        request.input(paramName, sql.NVarChar, JSON.stringify(val));
      }
    }

    const result = await request.query(transformedText);
    const rows = (result.recordset ?? []) as Row[];
    const rowCount =
      rows.length > 0
        ? rows.length
        : result.rowsAffected && result.rowsAffected.length > 0
          ? result.rowsAffected.reduce((sum, current) => sum + current, 0)
          : 0;

    return {
      rows,
      rowCount,
    };
  }

  private async runProcedure<Row extends QueryResultRow = QueryResultRow>(
    procedureName: string,
    params: Record<string, unknown>,
    runner: sql.ConnectionPool | sql.Transaction,
  ): Promise<QueryResult<Row>> {
    const request =
      runner instanceof sql.Transaction
        ? new sql.Request(runner)
        : new sql.Request(runner);
    for (const [key, val] of Object.entries(params)) {
      if (val === undefined || val === null) {
        request.input(key, sql.NVarChar, null);
      } else if (typeof val === 'boolean') {
        request.input(key, sql.Bit, val ? 1 : 0);
      } else if (typeof val === 'number') {
        if (Number.isInteger(val)) {
          request.input(key, sql.Int, val);
        } else {
          request.input(key, sql.Float, val);
        }
      } else if (val instanceof Date) {
        request.input(key, sql.DateTimeOffset, val);
      } else if (typeof val === 'string') {
        request.input(key, sql.NVarChar, val);
      } else {
        request.input(key, sql.NVarChar, JSON.stringify(val));
      }
    }
    const result = await request.execute(procedureName);
    const rows = (result.recordset ?? []) as Row[];
    const rowCount =
      rows.length > 0
        ? rows.length
        : result.rowsAffected && result.rowsAffected.length > 0
          ? result.rowsAffected.reduce((sum, current) => sum + current, 0)
          : 0;

    return {
      rows,
      rowCount,
    };
  }
}
