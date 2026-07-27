import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import { getTableConfig as getSqliteTableConfig } from "drizzle-orm/sqlite-core";
import { getTableConfig as getPgTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  columnName,
  sqlDefaultSignature,
  sqlParts,
} from "./schema-parity.test-utils";
import * as sqliteApp from "./app.schema";
import * as sqliteSam from "./sam.schema";
import * as sqliteAuth from "./better-auth-schema";
import * as sqliteBilling from "./billing.schema";
import * as sqliteGsc from "./gsc.schema";
import * as sqliteReddit from "./reddit-attribution.schema";
import * as sqliteTelemetry from "./telemetry.schema";
import * as sqliteDemandPulse from "./demand-pulse.schema";
import * as sqliteDemandPulseEvidence from "./demand-pulse-evidence.schema";
import * as sqliteDemandPulseFamily from "./demand-pulse-family.schema";
import * as sqliteDemandPulseFeed from "./demand-pulse-feed.schema";
import * as pgApp from "./pg/app.schema";
import * as pgSam from "./pg/sam.schema";
import * as pgAuth from "./pg/better-auth-schema";
import * as pgBilling from "./pg/billing.schema";
import * as pgGsc from "./pg/gsc.schema";
import * as pgReddit from "./pg/reddit-attribution.schema";
import * as pgTelemetry from "./pg/telemetry.schema";
import * as pgDemandPulse from "./pg/demand-pulse.schema";
import * as pgDemandPulseEvidence from "./pg/demand-pulse-evidence.schema";
import * as pgDemandPulseFamily from "./pg/demand-pulse-family.schema";
import * as pgDemandPulseFeed from "./pg/demand-pulse-feed.schema";

// Guards the ONE structural artifact `db:generate` does not regenerate: the
// hand-written Postgres schema. The provider-aware `db`/`@/db/schema` barrel
// types Postgres as the SQLite schema via a cast, so these two schemas MUST stay
// structurally interchangeable or that cast lies. This test fails loudly the
// moment they drift (e.g. a table added to one dialect but not the other).

type Dialect = "sqlite" | "pg";

const sortStrings = (values: string[]) =>
  values.toSorted((a, b) => a.localeCompare(b));

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return sortStrings(value.filter((v): v is string => typeof v === "string"));
}

function tablesFrom(...modules: Record<string, unknown>[]) {
  const out = new Map<string, Table>();
  for (const mod of modules) {
    for (const value of Object.values(mod)) {
      if (is(value, Table)) out.set(getTableName(value), value);
    }
  }
  return out;
}

const getConfig = (table: Table, dialect: Dialect) =>
  dialect === "pg" ? getPgTableConfig(table) : getSqliteTableConfig(table);

type ColumnInfo = {
  name: string;
  notNull: boolean;
  dataType: string;
  hasDefault: boolean;
  enumValues: string[] | null;
};

function columnsOf(table: Table): ColumnInfo[] {
  return Object.values(getTableColumns(table)).map((col) => ({
    name: col.name,
    notNull: col.notNull,
    // `dataType` resolves to `any` via Drizzle's column config generic; narrow it.
    dataType: typeof col.dataType === "string" ? col.dataType : "unknown",
    hasDefault: col.hasDefault,
    enumValues: asStringArray(col.enumValues),
  }));
}

function defaultOf(table: Table, name: string): unknown {
  const column = Object.values(getTableColumns(table)).find(
    (candidate) => candidate.name === name,
  );
  if (!column) throw new Error(`Missing column ${name}`);
  return Reflect.get(column, "default");
}

function uniqueColumnTuples(table: Table, dialect: Dialect): string[] {
  const config = getConfig(table, dialect);
  const tuples = new Set<string>();
  for (const index of config.indexes) {
    if (!index.config.unique) continue;
    const cols = index.config.columns
      .map(columnName)
      .filter((name): name is string => name !== null);
    tuples.add(cols.join(",") + (index.config.where ? "|partial" : ""));
  }
  for (const constraint of config.uniqueConstraints) {
    tuples.add(constraint.columns.map((c) => c.name).join(","));
  }
  for (const col of Object.values(getTableColumns(table))) {
    if (col.isUnique) tuples.add(col.name);
  }
  return sortStrings([...tuples]);
}

function primaryKeyColumns(table: Table, dialect: Dialect): string[] {
  const config = getConfig(table, dialect);
  const pk = new Set<string>();
  for (const col of Object.values(getTableColumns(table))) {
    if (col.primary) pk.add(col.name);
  }
  for (const composite of config.primaryKeys) {
    for (const col of composite.columns) pk.add(col.name);
  }
  return sortStrings([...pk]);
}

// FK signatures retain local[i]→foreign[i] positional mappings while sorting
// the complete signature list for stable comparison.
function foreignKeys(table: Table, dialect: Dialect): string[] {
  const config = getConfig(table, dialect);
  return sortStrings(
    config.foreignKeys.map((fk) => {
      const ref = fk.reference();
      const mapping = ref.columns
        .map(
          (column, index) =>
            `${column.name}->${ref.foreignColumns[index]?.name ?? "?"}`,
        )
        .join(",");
      const refTable = getTableName(ref.foreignTable);
      return `${refTable}.${mapping} onDelete=${fk.onDelete ?? "none"}`;
    }),
  );
}

function indexShapes(table: Table, dialect: Dialect): string[] {
  const config = getConfig(table, dialect);
  return sortStrings(
    config.indexes.map((index) => {
      const cols = index.config.columns
        .map(columnName)
        .filter((name): name is string => name !== null);
      return `${index.config.name}|${cols.join(",")}|${index.config.unique ? "unique" : "index"}|${index.config.where ? "partial" : "full"}`;
    }),
  );
}

function checkShapes(table: Table, dialect: Dialect): string[] {
  return sortStrings(
    getConfig(table, dialect).checks.map((constraint) => {
      const expression = sqlParts(constraint.value)
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/= false\b/g, "= 0")
        .trim();
      return `${constraint.name}:${expression}`;
    }),
  );
}

function normalizeDefault(value: unknown): string {
  if (value !== null && typeof value === "object") {
    return sqlDefaultSignature(value);
  }
  return JSON.stringify(value) ?? "undefined";
}

function defaultShapes(table: Table): string[] {
  return sortStrings(
    columnsOf(table)
      .filter((column) => column.hasDefault)
      .map((column) => {
        const value = defaultOf(table, column.name);
        return `${column.name}:${normalizeDefault(value)}`;
      }),
  );
}

const sqliteAppTables = tablesFrom(
  sqliteApp,
  sqliteSam,
  sqliteBilling,
  sqliteGsc,
  sqliteReddit,
  sqliteTelemetry,
  sqliteDemandPulse,
  sqliteDemandPulseEvidence,
  sqliteDemandPulseFamily,
  sqliteDemandPulseFeed,
);
const pgAppTables = tablesFrom(
  pgApp,
  pgSam,
  pgBilling,
  pgGsc,
  pgReddit,
  pgTelemetry,
  pgDemandPulse,
  pgDemandPulseEvidence,
  pgDemandPulseFamily,
  pgDemandPulseFeed,
);
const sqliteAuthTables = tablesFrom(sqliteAuth);
const pgAuthTables = tablesFrom(pgAuth);

describe("schema parity: application tables", () => {
  it("define the same set of tables on both backends", () => {
    expect(sortStrings([...pgAppTables.keys()])).toEqual(
      sortStrings([...sqliteAppTables.keys()]),
    );
  });

  for (const [name, sqliteTable] of sqliteAppTables) {
    const pgTable = pgAppTables.get(name);
    if (!pgTable) continue; // reported by the table-set assertion above

    describe(`table "${name}"`, () => {
      it("has matching columns (name, nullability, type, default, enum)", () => {
        // dataType is dialect-agnostic ("string"/"number"/"boolean"/"date") so
        // text/text, boolean/boolean, serial/autoincrement match; a real type
        // mismatch is caught.
        expect(columnsOf(pgTable)).toEqual(columnsOf(sqliteTable));
      });
      it("has matching primary key", () => {
        expect(primaryKeyColumns(pgTable, "pg")).toEqual(
          primaryKeyColumns(sqliteTable, "sqlite"),
        );
      });
      it("has matching unique constraints (onConflict targets)", () => {
        expect(uniqueColumnTuples(pgTable, "pg")).toEqual(
          uniqueColumnTuples(sqliteTable, "sqlite"),
        );
      });
      it("has matching foreign keys (incl. onDelete)", () => {
        expect(foreignKeys(pgTable, "pg")).toEqual(
          foreignKeys(sqliteTable, "sqlite"),
        );
      });
      it("has matching indexes", () => {
        expect(indexShapes(pgTable, "pg")).toEqual(
          indexShapes(sqliteTable, "sqlite"),
        );
      });
      it("has matching check constraints", () => {
        expect(checkShapes(pgTable, "pg")).toEqual(
          checkShapes(sqliteTable, "sqlite"),
        );
      });
      it("has matching defaults", () => {
        expect(defaultShapes(pgTable)).toEqual(defaultShapes(sqliteTable));
      });
    });
  }
});

describe("schema parity: Demand Pulse safety defaults", () => {
  it("keeps profile safety controls fail-closed on both dialects", () => {
    for (const profile of [
      sqliteDemandPulse.demandPulseProfiles,
      pgDemandPulse.demandPulseProfiles,
    ]) {
      expect(defaultOf(profile, "enabled")).toBe(false);
      expect(defaultOf(profile, "dry_run")).toBe(true);
      expect(defaultOf(profile, "publication_disabled")).toBe(true);
    }
  });

  it("allows unknown observation publication time in both dialects", () => {
    for (const observations of [
      sqliteDemandPulseEvidence.demandPulseObservations,
      pgDemandPulseEvidence.demandPulseObservations,
    ]) {
      const publishedAt = columnsOf(observations).find(
        (column) => column.name === "published_at",
      );
      expect(publishedAt?.notNull).toBe(false);
      expect(
        columnsOf(observations).find((column) => column.name === "collected_at")
          ?.notNull,
      ).toBe(true);
    }
  });
});

describe("schema parity: better-auth tables", () => {
  // better-auth schemas are generated per-dialect (auth:generate) and are
  // intentionally dialect-native in column TYPE (SQLite integer-timestamp_ms /
  // text-json vs Postgres timestamptz / jsonb). So we assert structure that
  // MUST match — table set, column names, nullability, PK, unique constraints —
  // but not dataType. This catches a column/table added or removed on one
  // dialect but not the other (e.g. a stale-oauth-tables drift, or a
  // better-auth upgrade applied to only one schema).
  it("define the same set of tables on both backends", () => {
    expect(sortStrings([...pgAuthTables.keys()])).toEqual(
      sortStrings([...sqliteAuthTables.keys()]),
    );
  });

  for (const [name, sqliteTable] of sqliteAuthTables) {
    const pgTable = pgAuthTables.get(name);
    if (!pgTable) continue;

    describe(`table "${name}"`, () => {
      it("has matching column names + nullability", () => {
        const shape = (table: Table) =>
          Object.fromEntries(columnsOf(table).map((c) => [c.name, c.notNull]));
        expect(shape(pgTable)).toEqual(shape(sqliteTable));
      });
      it("has matching primary key", () => {
        expect(primaryKeyColumns(pgTable, "pg")).toEqual(
          primaryKeyColumns(sqliteTable, "sqlite"),
        );
      });
      it("has matching unique constraints", () => {
        expect(uniqueColumnTuples(pgTable, "pg")).toEqual(
          uniqueColumnTuples(sqliteTable, "sqlite"),
        );
      });
    });
  }
});

// Secondary indexes that better-auth's `generate` CLI does NOT emit — they are
// hand-added to both schema files for query performance. Running `auth:generate`
// overwrites the files and drops them, so this guard fails loudly (on either
// dialect) if a regen forgets to re-apply them. Columns are SQL column names.
const REQUIRED_BETTER_AUTH_INDEXES: {
  table: string;
  columns: string[];
  unique: boolean;
}[] = [
  { table: "session", columns: ["user_id"], unique: false },
  { table: "account", columns: ["user_id"], unique: false },
  { table: "account", columns: ["account_id", "provider_id"], unique: false },
  { table: "verification", columns: ["identifier"], unique: false },
  { table: "verification", columns: ["expires_at"], unique: false },
  { table: "organization", columns: ["slug"], unique: true },
  { table: "member", columns: ["organization_id"], unique: false },
  { table: "member", columns: ["user_id"], unique: false },
  { table: "invitation", columns: ["organization_id"], unique: false },
  { table: "invitation", columns: ["email"], unique: false },
];

function indexKeys(table: Table, dialect: Dialect): string[] {
  const config = getConfig(table, dialect);
  return config.indexes.map((index) => {
    const cols = index.config.columns
      .map(columnName)
      .filter((name): name is string => name !== null);
    return `${sortStrings(cols).join(",")}|${index.config.unique ? "unique" : "index"}`;
  });
}

describe("better-auth required indexes (CLI omits them; re-apply after auth:generate)", () => {
  for (const dialect of ["sqlite", "pg"] as const) {
    const tables = dialect === "pg" ? pgAuthTables : sqliteAuthTables;
    describe(dialect, () => {
      for (const req of REQUIRED_BETTER_AUTH_INDEXES) {
        const label = `${req.table}(${req.columns.join(",")})${req.unique ? " unique" : ""}`;
        it(`has index ${label}`, () => {
          const table = tables.get(req.table);
          expect(table, `missing table "${req.table}"`).toBeDefined();
          if (!table) return;
          const key = `${sortStrings(req.columns).join(",")}|${req.unique ? "unique" : "index"}`;
          expect(indexKeys(table, dialect)).toContain(key);
        });
      }
    });
  }
});

describe("no direct db.batch (must use runBatch)", () => {
  // `db.batch` only exists on the D1 driver; on Postgres it throws. All atomic
  // multi-statement writes must go through `runBatch`, which is the only file
  // allowed to call `.batch`.
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(path));
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
        out.push(path);
    }
    return out;
  }

  it("is not called outside src/db/runBatch.ts", () => {
    const offenders = walk("src")
      .filter((path) => !path.endsWith(join("db", "runBatch.ts")))
      .filter((path) => /\.batch\(/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
