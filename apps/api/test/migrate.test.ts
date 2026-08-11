import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMigrate = vi.fn();
const mockDrizzle = vi.fn((client: unknown) => ({ _client: client }));
const mockLock = vi.fn().mockResolvedValue([{ pg_advisory_lock: null }]);
const mockUnlock = vi.fn().mockResolvedValue([{ pg_advisory_unlock: null }]);
const mockEnd = vi.fn().mockResolvedValue(undefined);

const mockClient = vi.fn().mockImplementation(() => {
  const sql = vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join('');
    if (query.includes('pg_advisory_lock')) return mockLock();
    if (query.includes('pg_advisory_unlock')) return mockUnlock();
    return Promise.resolve([]);
  }) as unknown as ((strings: TemplateStringsArray) => Promise<unknown[]>) & { end: typeof mockEnd };
  sql.end = mockEnd;
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
const { runMigrations } = await import('../src/migrate.js');

describe('runMigrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMigrate.mockResolvedValue(undefined);
  });

  it('acquires advisory lock, runs migrations, then releases lock', async () => {
    await runMigrations();

    expect(mockLock).toHaveBeenCalled();
    expect(mockMigrate).toHaveBeenCalled();
    expect(mockUnlock).toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalled();
  });

  it('releases lock even when migration throws', async () => {
    mockMigrate.mockRejectedValueOnce(new Error('migration failed'));
    await expect(runMigrations()).rejects.toThrow('migration failed');
    expect(mockUnlock).toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalled();
  });

  it('passes the migrations folder path to drizzle migrate', async () => {
    await runMigrations();
    expect(mockMigrate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ migrationsFolder: expect.stringContaining('migrations') }),
    );
  });
});
