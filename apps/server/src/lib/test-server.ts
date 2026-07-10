import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';
import type { Db } from '../db/client.js';
import { users, orgSettings, assetTypes, type UserRow } from '../db/schema.js';
import type { Env } from '../env.js';
import type { Email, EmailSender } from './email.js';
import { SESSION_COOKIE, createSession } from './sessions.js';
import { createTestDb } from './test-db.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_ENV_BASE: Env = {
  NODE_ENV: 'test',
  PORT: 3001,
  DATABASE_URL: 'file::memory:',
  PUBLIC_APP_URL: 'http://localhost:5173',
  UPLOAD_DIR: './data/uploads',
  UPLOAD_MAX_BYTES: 5_242_880,
  MCP_ACCESS_TOKEN_TTL: 3600,
  MCP_REFRESH_TOKEN_TTL: 60 * 60 * 24 * 30,
};

function freshTestEnv(): Env {
  return {
    ...TEST_ENV_BASE,
    UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'inv-uploads-')),
  };
}

type Role = UserRow['role'];

class MemoryEmailSender implements EmailSender {
  readonly sent: Email[] = [];
  async send(email: Email): Promise<void> {
    this.sent.push(email);
  }
}

export type TestServer = {
  app: ReturnType<typeof createApp>;
  db: Db;
  sqlite: Database.Database;
  env: Env;
  close: () => void;
  createUser: (input?: { email?: string; name?: string; role?: Role }) => UserRow;
  loginAs: (user: UserRow) => string;
  authRequest: (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;
  laptopTypeId: string;
  sentEmails: Email[];
};

/**
 * Bootstraps an in-memory app instance with an OrgSettings singleton and
 * one default asset type (`LAP`). Returns helpers to spawn users + perform
 * authenticated requests via `app.request`.
 */
export function setupTestServer(): TestServer {
  const { db, sqlite } = createTestDb();
  const emailSender = new MemoryEmailSender();
  const env = freshTestEnv();
  const app = createApp({ db, env, emailSender });

  db.insert(orgSettings)
    .values({ id: 'singleton', name: 'Test Org', codePrefix: null, allowedDomains: [] })
    .run();
  const laptopTypeId = crypto.randomUUID();
  db.insert(assetTypes).values({ id: laptopTypeId, name: 'Laptop', codePrefix: 'LAP' }).run();

  let userCounter = 0;

  const createUser: TestServer['createUser'] = (input = {}) => {
    userCounter += 1;
    const id = crypto.randomUUID();
    const email = input.email ?? `test${userCounter}@example.com`;
    const name = input.name ?? `Test User ${userCounter}`;
    const role = input.role ?? 'admin';
    db.insert(users).values({ id, email, name, role }).run();
    return db.select().from(users).where(eq(users.id, id)).get()!;
  };

  const loginAs: TestServer['loginAs'] = (user) => {
    const { token } = createSession(db, user.id);
    return `${SESSION_COOKIE}=${token}`;
  };

  const authRequest: TestServer['authRequest'] = async (path, init) => {
    const headers = new Headers(init?.headers);
    if (init?.cookie) headers.set('Cookie', init.cookie);
    // Pretend to be a same-origin browser request so the CSRF middleware
    // doesn't block POST/PATCH/DELETE in tests.
    if (!headers.has('Origin')) headers.set('Origin', env.PUBLIC_APP_URL);
    return app.request(path, { ...init, headers });
  };

  return {
    app,
    db,
    sqlite,
    env,
    close: () => {
      sqlite.close();
      try {
        rmSync(env.UPLOAD_DIR, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
    createUser,
    loginAs,
    authRequest,
    laptopTypeId,
    sentEmails: emailSender.sent,
  };
}
