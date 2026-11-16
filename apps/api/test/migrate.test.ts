import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMigrate = vi.fn();
const mockDrizzle = vi.fn((client: unknown) => ({ _client: client }));
const mockLock = vi.fn();
const mockUnlock = vi.fn();
const mockEnd = vi.fn();
const mockUnsafe = vi.fn();

const mockClient = vi.fn().mockImplementation(() => {
  const sql = vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join('');
    if (query.includes('pg_advisory_lock')) return mockLock();
    if (query.includes('pg_advisory_unlock')) return mockUnlock();
    return Promise.resolve([]);
  }) as unknown as ((strings: TemplateStringsArray) => Promise<unknown[]>) & {
    end: typeof mockEnd;
    unsafe: typeof mockUnsafe;
  };
  sql.end = mockEnd;
  sql.unsafe = mockUnsafe;
  return sql;
});

vi.mock('postgres', () => ({ default: mockClient }));
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: mockDrizzle }));
vi.mock('drizzle-orm/postgres-js/migrator', () => ({ migrate: mockMigrate }));
vi.mock('@project-signal/config', () => ({
  getEnv: vi.fn(() => ({ DATABASE_URL: 'postgresql://localhost/test' })),
}));

/**
 * Imported ONCE, at module scope, rather than inside each test.
 *
 * These two tests failed intermittently under a full `yarn test` sweep — "Test timed out in
 * 5000ms" on the first, then "promise resolved undefined instead of rejecting" on the second.
 * The second was a consequence of the first: a timed-out test leaves its `runMigrations()` call
 * pending, and that pending call then consumes the `mockRejectedValueOnce` queued by the next
 * test, so the next test's own call resolves normally.
 *
 * The root cause was the dynamic `await import()` inside each test. Module resolution is charged
 * against the 5-second test timeout, and on a machine running twelve project suites at once it
 * can exceed it. `vi.mock` is hoisted, so a module-scope import sees the mocks perfectly well —
 * the dynamic form bought nothing and put a variable cost inside a fixed budget.
 */
const { runMigrations, LOCK_TIMEOUT } = await import('../src/migrate.js');

describe('runMigrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMigrate.mockResolvedValue(undefined);
    mockLock.mockResolvedValue([{ pg_advisory_lock: null }]);
    mockUnlock.mockResolvedValue([{ pg_advisory_unlock: null }]);
    mockEnd.mockResolvedValue(undefined);
    mockUnsafe.mockResolvedValue([]);
  });

  it('acquires advisory lock, runs migrations, then releases lock', async () => {
    await runMigrations();

    expect(mockLock).toHaveBeenCalled();
    expect(mockMigrate).toHaveBeenCalled();
    expect(mockUnlock).toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalled();
  });

  it('bounds the wait for the lock, so a hung holder cannot block every boot forever', async () => {
    await runMigrations();
    expect(mockUnsafe).toHaveBeenCalledWith(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    // Set BEFORE the lock is requested, or it would not govern that wait.
    expect(mockUnsafe.mock.invocationCallOrder[0]!).toBeLessThan(
      mockLock.mock.invocationCallOrder[0]!,
    );
  });

  it('releases lock even when migration throws', async () => {
    mockMigrate.mockRejectedValueOnce(new Error('migration failed'));
    await expect(runMigrations()).rejects.toThrow('migration failed');
    expect(mockUnlock).toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalled();
  });

  it('reports the LOCK failure itself, and does not try to release a lock it never held', async () => {
    // Previously the unlock in `finally` ran regardless, and its own failure replaced this one.
    mockLock.mockRejectedValueOnce(new Error('canceling statement due to lock timeout'));
    await expect(runMigrations()).rejects.toThrow('lock timeout');
    expect(mockUnlock).not.toHaveBeenCalled();
    expect(mockMigrate).not.toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalled();
  });

  it('keeps the migration error when the unlock and the disconnect also fail', async () => {
    mockMigrate.mockRejectedValueOnce(new Error('migration failed'));
    mockUnlock.mockRejectedValueOnce(new Error('connection gone'));
    mockEnd.mockRejectedValueOnce(new Error('already closed'));
    await expect(runMigrations()).rejects.toThrow('migration failed');
  });

  it('fails loudly when the migrations folder is missing, instead of booting unmigrated', async () => {
    await expect(runMigrations('C:/definitely/not/a/real/migrations/dir')).rejects.toThrow(
      /Migrations folder not found/,
    );
    expect(mockClient).not.toHaveBeenCalled();
  });

  it('passes the migrations folder path to drizzle migrate', async () => {
    await runMigrations();
    expect(mockMigrate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ migrationsFolder: expect.stringContaining('migrations') }),
    );
  });
});
