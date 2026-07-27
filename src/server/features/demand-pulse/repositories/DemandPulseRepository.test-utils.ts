import { vi } from "vitest";

export type InsertConflictCapture = {
  kind: "nothing" | "update";
  target: unknown[];
  set?: Record<string, unknown>;
  setWhere?: unknown;
};

export type SelectJoinCapture = { table: unknown; on: unknown };

export type DemandPulseDbState = {
  selectRows: unknown[];
  selectWheres: unknown[];
  selectJoins: SelectJoinCapture[];
  insertRows: unknown[][];
  insertValues: unknown[];
  insertConflicts: InsertConflictCapture[];
  insertCalls: number;
  updateRows: unknown[][];
  updateSets: Record<string, unknown>[];
  updateWheres: unknown[];
};

const state: DemandPulseDbState = {
  selectRows: [],
  selectWheres: [],
  selectJoins: [],
  insertRows: [],
  insertValues: [],
  insertConflicts: [],
  insertCalls: 0,
  updateRows: [],
  updateSets: [],
  updateWheres: [],
};

const dbSelect = vi.fn(() => {
  const from = vi.fn(() => {
    const where = vi.fn((condition: unknown) => {
      state.selectWheres.push(condition);
      const promise = Promise.resolve(state.selectRows);
      return Object.assign(promise, {
        limit: vi.fn(() => Promise.resolve(state.selectRows)),
      });
    });
    return {
      where,
      innerJoin: vi.fn((table: unknown, on: unknown) => {
        state.selectJoins.push({ table, on });
        return { where };
      }),
    };
  });
  return { from };
});

const dbInsert = vi.fn(() => {
  state.insertCalls += 1;
  const values = vi.fn((input: unknown) => {
    state.insertValues.push(input);
    return {
      onConflictDoNothing: vi.fn((config: { target: unknown[] }) => {
        state.insertConflicts.push({ kind: "nothing", target: config.target });
        return {
          returning: vi.fn(() =>
            Promise.resolve(state.insertRows.shift() ?? []),
          ),
        };
      }),
      onConflictDoUpdate: vi.fn(
        (config: {
          target: unknown[];
          set: Record<string, unknown>;
          setWhere?: unknown;
        }) => {
          state.insertConflicts.push({
            kind: "update",
            target: config.target,
            set: config.set,
            setWhere: config.setWhere,
          });
          return {
            returning: vi.fn(() =>
              Promise.resolve(state.insertRows.shift() ?? []),
            ),
          };
        },
      ),
    };
  });
  return { values };
});

const dbUpdate = vi.fn(() => {
  const set = vi.fn((input: Record<string, unknown>) => {
    state.updateSets.push(input);
    return {
      where: vi.fn((condition: unknown) => {
        state.updateWheres.push(condition);
        return {
          returning: vi.fn(() =>
            Promise.resolve(state.updateRows.shift() ?? []),
          ),
        };
      }),
    };
  });
  return { set };
});

export const demandPulseDbMocks = {
  db: { select: dbSelect, insert: dbInsert, update: dbUpdate },
  state,
  reset() {
    state.selectRows = [];
    state.selectWheres = [];
    state.selectJoins = [];
    state.insertRows = [];
    state.insertValues = [];
    state.insertConflicts = [];
    state.insertCalls = 0;
    state.updateRows = [];
    state.updateSets = [];
    state.updateWheres = [];
  },
};

export function collectSqlParams(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  if ("value" in value && "encoder" in value) return [value.value];
  if (!("queryChunks" in value) || !Array.isArray(value.queryChunks)) return [];
  return value.queryChunks.flatMap(collectSqlParams);
}

export function collectSqlObjects(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  if ("queryChunks" in value && Array.isArray(value.queryChunks)) {
    return value.queryChunks.flatMap((chunk: unknown) => [
      chunk,
      ...collectSqlObjects(chunk),
    ]);
  }
  return [value];
}

export function collectSqlText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  if ("value" in value && Array.isArray(value.value)) {
    return value.value
      .filter((part): part is string => typeof part === "string")
      .join("");
  }
  if ("queryChunks" in value && Array.isArray(value.queryChunks)) {
    return value.queryChunks.map(collectSqlText).join("");
  }
  return "";
}
