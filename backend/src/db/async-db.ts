/**
 * Asenkron DB katmanı (#7) — yalnız PostgreSQL (pg).
 *
 * Bağlantı: `DATABASE_URL` (ZORUNLU). Tüm API asenkrondur. Servisler
 * `dbAll/dbOne/dbRun/dbExec/dbTx` kullanır; somut sürücüden bağımsızdır.
 *
 * SQL taşınabilirliği — servisler SQL'i `?` + SQLite-lehçesiyle yazmaya devam
 * eder, burada pg'ye çevrilir:
 *  - `?`                → `$1, $2, …` (pozisyonel)
 *  - `CURRENT_TIMESTAMP`→ `to_char(now(),'YYYY-MM-DD HH24:MI:SS')` (string format korunur)
 *  - `INSERT OR IGNORE` → `INSERT … ON CONFLICT DO NOTHING`
 * Tarih/zaman kolonları pg'de de TEXT (string karşılaştırma davranışı korunur).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '../utils/logger';

export type Dialect = 'pg';

export interface RunResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

/** Transaction içinde çağrılan sorgu yüzeyi (tek bağlantı/işlem üstünde). */
export interface DbExecutor {
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
}

export function getDialect(): Dialect {
  return 'pg';
}

export function isPg(): boolean {
  return true;
}

/* ============================================================
 * pg lehçe çevirisi
 * ============================================================ */

function translateForPg(sql: string): string {
  let s = sql;
  // SQLite string-zaman formatını koru.
  s = s.replace(/CURRENT_TIMESTAMP/g, "to_char(now(), 'YYYY-MM-DD HH24:MI:SS')");
  // INSERT OR IGNORE → ON CONFLICT DO NOTHING
  let ignore = false;
  s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, () => {
    ignore = true;
    return 'INSERT INTO';
  });
  if (ignore) {
    s = s.replace(/\s*;?\s*$/, '') + ' ON CONFLICT DO NOTHING';
  }
  // ? → $n (pozisyonel). Not: SQL string literal'lerinde ? kullanılmıyor.
  let i = 0;
  s = s.replace(/\?/g, () => `$${(i += 1)}`);
  return s;
}

/* ============================================================
 * PostgreSQL sürücüsü (pg Pool — asenkron)
 * ============================================================ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pgPool: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pgPoolHandle(): any {
  if (pgPool) return pgPool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL gerekli — sistem yalnız PostgreSQL ile çalışır.');
  }
   
  const pg = require('pg');
  // COUNT(*) vb. bigint (OID 20) varsayılan string döner → SQLite gibi number yap.
  // (id/sayım değerleri küçük; precision kaybı yok. int4 zaten number döner.)
  pg.types.setTypeParser(20, (v: string) => parseInt(v, 10));
  const { Pool } = pg;
  const isProduction = (process.env.NODE_ENV ?? 'development') === 'production';
  // Prod'da TLS zorunlu (managed/uzak Postgres). PGSSL=disable ile bilinçli
  // kapatılabilir (örn. iç ağda sidecar-TLS). sslmode connection string'de de
  // verilebilir; buradaki ayar pg sürücüsüne sertifika doğrulamasını söyler.
  const sslDisabled = process.env.PGSSL === 'disable' || /sslmode=disable/.test(url);
  const ssl = isProduction && !sslDisabled ? { rejectUnauthorized: true } : false;
  pgPool = new Pool({
    connectionString: url,
    max: parseInt(process.env.DB_POOL_MAX ?? '10', 10) || 10,
    // Kaçak/asılı sorgular pool'u kilitlemesin (banka SLA + DoS sertleştirme).
    statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS ?? '15000', 10) || 15000,
    query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT_MS ?? '15000', 10) || 15000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT_MS ?? '5000', 10) || 5000,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS ?? '30000', 10) || 30000,
    ssl,
  });
  pgPool.on('error', (err: Error) => logger.error('pg_pool_error', { err: err.message }));
  logger.info('pg_pool_initialized', { ssl: ssl !== false, max: pgPool.options?.max ?? 10 });
  return pgPool;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pgExecutor(runner: { query: (text: string, params?: unknown[]) => Promise<any> }): DbExecutor {
  return {
    async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const res = await runner.query(translateForPg(sql), params);
      return res.rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      const res = await runner.query(translateForPg(sql), params);
      return (res.rows[0] as T) ?? undefined;
    },
    async run(sql: string, params: unknown[] = []): Promise<RunResult> {
      const res = await runner.query(translateForPg(sql), params);
      return { changes: res.rowCount ?? 0 };
    },
    async exec(sql: string): Promise<void> {
      // Çoklu-statement DDL: pg tek query'de ';' ile ayrılmış çalıştırabilir.
      await runner.query(sql);
    },
  };
}

/* ============================================================
 * Aktif executor + public API
 * ============================================================ */

function activeExecutor(): DbExecutor {
  return pgExecutor(pgPoolHandle());
}

/**
 * Aktif transaction context'i. dbTx içindeyken global dbAll/dbOne/dbRun/dbExec
 * OTOMATİK transaction client'ına yönlenir. Böylece transaction gövdesinde ekstra
 * `tx.` kullanımı GEREKMEZ — sadece sarmalama.
 */
const txContext = new AsyncLocalStorage<DbExecutor>();

function currentExecutor(): DbExecutor {
  return txContext.getStore() ?? activeExecutor();
}

export function dbAll<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  return currentExecutor().all<T>(sql, params);
}

export function dbOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return currentExecutor().one<T>(sql, params);
}

export function dbRun(sql: string, params: unknown[] = []): Promise<RunResult> {
  return currentExecutor().run(sql, params);
}

export function dbExec(sql: string): Promise<void> {
  return currentExecutor().exec(sql);
}

/**
 * Atomik transaction (pg): havuzdan tek client, BEGIN/COMMIT/ROLLBACK.
 * ALS: gövdedeki global dbX çağrıları bu client'a (transaction'a) yönlenir.
 */
export async function dbTx<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  const client = await pgPoolHandle().connect();
  const tx = pgExecutor(client);
  try {
    await client.query('BEGIN');
    const result = await txContext.run(tx, () => fn(tx));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
}
