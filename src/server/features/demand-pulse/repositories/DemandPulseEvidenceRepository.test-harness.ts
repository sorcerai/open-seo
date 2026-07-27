import { vi } from "vitest";

type ConflictConfig = {
  target: readonly unknown[];
};

type WriteCapture = {
  table: unknown;
  row: unknown;
  conflict: ConflictConfig;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const hasName = (value: object): value is { name: unknown } => "name" in value;

const targetKey = (row: unknown, config: ConflictConfig) => {
  const fields = config.target.map((column: unknown) => {
    if (!column || typeof column !== "object") return String(column);
    if (hasName(column)) {
      return String(column.name).replace(
        /_([a-z])/g,
        (_match, letter: string) => letter.toUpperCase(),
      );
    }
    return Object.prototype.toString.call(column);
  });
  const record = isRecord(row) ? row : undefined;
  return fields
    .map((field) => `${field}:${JSON.stringify(record?.[field])}`)
    .join("|");
};

export const harness = (() => {
  const writes: WriteCapture[] = [];
  const persistedRows = new Map<string, unknown>();
  const selectWheres: unknown[] = [];
  const rowsByTable = new Map<unknown, unknown[]>();

  const tx = {
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((row: unknown) => ({
        onConflictDoNothing: vi.fn((config: ConflictConfig) => {
          const key = targetKey(row, config);
          if (!persistedRows.has(key)) {
            persistedRows.set(key, row);
            writes.push({ table, row, conflict: config });
          }
          return Promise.resolve();
        }),
        onConflictDoUpdate: vi.fn((config: ConflictConfig) => {
          persistedRows.set(targetKey(row, config), row);
          writes.push({ table, row, conflict: config });
          return Promise.resolve();
        }),
      })),
    })),
  };

  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn((condition: unknown) => {
          selectWheres.push(condition);
          return Promise.resolve(rowsByTable.get(table) ?? []);
        }),
      })),
    })),
  };

  return {
    db,
    tx,
    writes,
    persistedRows,
    selectWheres,
    rowsByTable,
    executeInBatches: vi.fn(
      async (
        items: readonly unknown[],
        build: (executor: typeof tx, item: unknown) => Promise<unknown>,
      ) => {
        for (const item of items) await build(tx, item);
      },
    ),
    reset() {
      writes.length = 0;
      persistedRows.clear();
      selectWheres.length = 0;
      rowsByTable.clear();
      harness.executeInBatches.mockClear();
      harness.db.select.mockClear();
      harness.tx.insert.mockClear();
    },
  };
})();

vi.doMock("cloudflare:workers", () => ({ env: {} }));
vi.doMock("@/db", () => ({ db: harness.db }));
vi.doMock("@/db/runBatch", () => ({
  executeInBatches: harness.executeInBatches,
}));

export const { DemandPulseEvidenceRepository } =
  await import("./DemandPulseEvidenceRepository");
