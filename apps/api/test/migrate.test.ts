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

describe('runMigrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMigrate.mockResolvedValue(undefined);
  });

  it('acquires advisory lock, runs migrations, then releases lock', async () => {
    const { runMigrations } = await import('../src/migrate.js');
    await runMigrations();

    expect(mockLock).toHaveBeenCalled();
    expect(mockMigrate).toHaveBeenCalled();
    expect(mockUnlock).toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalled();
  });

  it('releases lock even when migration throws', async () => {
    mockMigrate.mockRejectedValueOnce(new Error('migration failed'));
    const { runMigrations } = await import('../src/migrate.js');
    await expect(runMigrations()).rejects.toThrow('migration failed');
    expect(mockUnlock).toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalled();
  });

  it('passes the migrations folder path to drizzle migrate', async () => {
    const { runMigrations } = await import('../src/migrate.js');
    await runMigrations();
    expect(mockMigrate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ migrationsFolder: expect.stringContaining('migrations') }),
    );
  });
});
