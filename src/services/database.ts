import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'trades.db');
let db: sqlite3.Database | null = null;

export interface ScheduledJob {
  id: string;
  name: string;
  profiles: string[];
  settle: string;
  interval: string;
  scheduleInterval: string; // '5m', '15m', '1h', etc.
  threshold: number;
  contractsPerProfile: number;
  minVolume: number;
  tradeSizeUsd: number;
  leverage: number;
  isActive: boolean;
  createdAt: number;
  lastRun?: number;
  nextRun?: number;
}

export interface TradePosition {
  id: string;
  jobId: string;
  contract: string;
  foundByProfile: string;
  tradeCall: string; // 'long' or 'short'
  entryPrice: number;
  currentPrice: number;
  size: number;
  leverage: number;
  tradeSizeUsd: number;
  confidenceScore: number;
  entryOrderId?: string;
  takeProfitOrderId?: string;
  stopLossOrderId?: string;
  status: 'opening' | 'open' | 'closing' | 'closed' | 'failed';
  openedAt: number;
  closedAt?: number;
  unrealizedPnl: number;
  realizedPnl?: number;
  lastUpdated: number;
}

export interface SchedulerStats {
  totalJobs: number;
  activeJobs: number;
  totalTrades: number;
  openPositions: number;
  closedPositions: number;
  totalPnl: number;
  todayPnl: number;
}

// Initialize database
export async function initDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Failed to open database:', err);
        reject(err);
        return;
      }
      
      // Create tables
      createTables()
        .then(() => {
          console.log('Database initialized successfully');
          resolve();
        })
        .catch(reject);
    });
  });
}

async function createTables(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    const createJobsTable = `
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        profiles TEXT NOT NULL,
        settle TEXT NOT NULL,
        interval TEXT NOT NULL,
        scheduleInterval TEXT NOT NULL,
        threshold INTEGER NOT NULL,
        contractsPerProfile INTEGER NOT NULL,
        minVolume INTEGER NOT NULL,
        tradeSizeUsd REAL NOT NULL,
        leverage INTEGER NOT NULL,
        isActive INTEGER NOT NULL DEFAULT 1,
        createdAt INTEGER NOT NULL,
        lastRun INTEGER,
        nextRun INTEGER
      )
    `;

    const createPositionsTable = `
      CREATE TABLE IF NOT EXISTS trade_positions (
        id TEXT PRIMARY KEY,
        jobId TEXT NOT NULL,
        contract TEXT NOT NULL,
        foundByProfile TEXT NOT NULL,
        tradeCall TEXT NOT NULL,
        entryPrice REAL NOT NULL,
        currentPrice REAL NOT NULL,
        size REAL NOT NULL,
        leverage INTEGER NOT NULL,
        tradeSizeUsd REAL NOT NULL,
        confidenceScore INTEGER NOT NULL,
        entryOrderId TEXT,
        takeProfitOrderId TEXT,
        stopLossOrderId TEXT,
        status TEXT NOT NULL,
        openedAt INTEGER NOT NULL,
        closedAt INTEGER,
        unrealizedPnl REAL NOT NULL DEFAULT 0,
        realizedPnl REAL,
        lastUpdated INTEGER NOT NULL,
        FOREIGN KEY (jobId) REFERENCES scheduled_jobs (id)
      )
    `;

    db.serialize(() => {
      db!.run(createJobsTable, (err) => {
        if (err) {
          reject(err);
          return;
        }
      });

      db!.run(createPositionsTable, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  });
}

// Scheduled Jobs CRUD
export async function createScheduledJob(job: Omit<ScheduledJob, 'id' | 'createdAt'>): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    const id = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const createdAt = Date.now();
    const profiles = JSON.stringify(job.profiles);

    const sql = `
      INSERT INTO scheduled_jobs 
      (id, name, profiles, settle, interval, scheduleInterval, threshold, contractsPerProfile, minVolume, tradeSizeUsd, leverage, isActive, createdAt, nextRun)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // Calculate next run time
    const nextRun = calculateNextRun(job.scheduleInterval);

    db.run(sql, [
      id, job.name, profiles, job.settle, job.interval, job.scheduleInterval,
      job.threshold, job.contractsPerProfile, job.minVolume, job.tradeSizeUsd,
      job.leverage, job.isActive ? 1 : 0, createdAt, nextRun
    ], function(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(id);
    });
  });
}

export async function getScheduledJobs(): Promise<ScheduledJob[]> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    db.all('SELECT * FROM scheduled_jobs ORDER BY createdAt DESC', (err, rows: any[]) => {
      if (err) {
        reject(err);
        return;
      }

      const jobs = rows.map(row => ({
        ...row,
        profiles: JSON.parse(row.profiles),
        isActive: !!row.isActive
      }));
      resolve(jobs);
    });
  });
}

export async function updateJobLastRun(jobId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    const now = Date.now();
    db.run('UPDATE scheduled_jobs SET lastRun = ? WHERE id = ?', [now, jobId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function toggleJobStatus(jobId: string, isActive: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    db.run('UPDATE scheduled_jobs SET isActive = ? WHERE id = ?', [isActive ? 1 : 0, jobId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Trade Positions CRUD
export async function createTradePosition(position: Omit<TradePosition, 'id' | 'openedAt' | 'lastUpdated'>): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    const id = `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    const sql = `
      INSERT INTO trade_positions 
      (id, jobId, contract, foundByProfile, tradeCall, entryPrice, currentPrice, size, leverage, tradeSizeUsd, 
       confidenceScore, entryOrderId, takeProfitOrderId, stopLossOrderId, status, openedAt, lastUpdated, unrealizedPnl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [
      id, position.jobId, position.contract, position.foundByProfile, position.tradeCall,
      position.entryPrice, position.currentPrice, position.size, position.leverage,
      position.tradeSizeUsd, position.confidenceScore, position.entryOrderId,
      position.takeProfitOrderId, position.stopLossOrderId, position.status, now, now, position.unrealizedPnl
    ], function(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(id);
    });
  });
}

export async function getOpenPositions(): Promise<TradePosition[]> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    db.all("SELECT * FROM trade_positions WHERE status IN ('opening', 'open', 'closing') ORDER BY openedAt DESC", (err, rows: any[]) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows as TradePosition[]);
    });
  });
}

export async function getClosedPositions(): Promise<TradePosition[]> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    db.all("SELECT * FROM trade_positions WHERE status = 'closed' ORDER BY closedAt DESC LIMIT 100", (err, rows: any[]) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows as TradePosition[]);
    });
  });
}

export async function updatePositionPrice(positionId: string, currentPrice: number, unrealizedPnl: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    const now = Date.now();
    db.run(
      'UPDATE trade_positions SET currentPrice = ?, unrealizedPnl = ?, lastUpdated = ? WHERE id = ?',
      [currentPrice, unrealizedPnl, now, positionId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

export async function closePosition(positionId: string, realizedPnl: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    const now = Date.now();
    db.run(
      'UPDATE trade_positions SET status = ?, realizedPnl = ?, closedAt = ?, lastUpdated = ? WHERE id = ?',
      ['closed', realizedPnl, now, now, positionId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

export async function getSchedulerStats(): Promise<SchedulerStats> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    const queries = [
      'SELECT COUNT(*) as totalJobs FROM scheduled_jobs',
      'SELECT COUNT(*) as activeJobs FROM scheduled_jobs WHERE isActive = 1',
      'SELECT COUNT(*) as totalTrades FROM trade_positions',
      "SELECT COUNT(*) as openPositions FROM trade_positions WHERE status IN ('opening', 'open', 'closing')",
      "SELECT COUNT(*) as closedPositions FROM trade_positions WHERE status = 'closed'",
      'SELECT COALESCE(SUM(realizedPnl), 0) as totalPnl FROM trade_positions WHERE realizedPnl IS NOT NULL',
      `SELECT COALESCE(SUM(realizedPnl), 0) as todayPnl FROM trade_positions 
       WHERE realizedPnl IS NOT NULL AND closedAt > ${Date.now() - 24*60*60*1000}`
    ];

    Promise.all(queries.map(query => 
      new Promise<any>((resolve, reject) => {
        db!.get(query, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      })
    )).then(results => {
      const stats: SchedulerStats = {
        totalJobs: results[0].totalJobs,
        activeJobs: results[1].activeJobs,
        totalTrades: results[2].totalTrades,
        openPositions: results[3].openPositions,
        closedPositions: results[4].closedPositions,
        totalPnl: results[5].totalPnl,
        todayPnl: results[6].todayPnl
      };
      resolve(stats);
    }).catch(reject);
  });
}

// Helper functions
function calculateNextRun(scheduleInterval: string): number {
  const now = Date.now();
  const intervals: { [key: string]: number } = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '2h': 2 * 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '12h': 12 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000
  };

  const interval = intervals[scheduleInterval] || intervals['1h'];
  return now + interval;
}

export function closeDatabase(): void {
  if (db) {
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      } else {
        console.log('Database connection closed.');
      }
    });
    db = null;
  }
}
