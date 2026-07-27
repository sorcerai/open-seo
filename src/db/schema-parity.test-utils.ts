function propertyOf(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

export function columnName(candidate: unknown): string | null {
  if (candidate && typeof candidate === "object") {
    const name = propertyOf(candidate, "name");
    if (typeof name === "string") return name;
  }
  return null;
}

export function sqlParts(value: unknown): string {
  const name = columnName(value);
  if (name) return name;
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return `${value}`;
  }
  if (typeof value === "symbol") return value.description ?? "";
  if (typeof value !== "object") return "";
  const queryChunks = propertyOf(value, "queryChunks");
  if (Array.isArray(queryChunks)) return queryChunks.map(sqlParts).join("");
  const parts = propertyOf(value, "value");
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part): part is string => typeof part === "string")
    .join("");
}

export function sqlDefaultSignature(value: object): string {
  const queryChunks = propertyOf(value, "queryChunks");
  if (!Array.isArray(queryChunks)) return `sql:${JSON.stringify(value)}`;
  const signature = queryChunks
    .map((chunk: unknown) => {
      if (chunk && typeof chunk === "object") {
        const chunkValue = propertyOf(chunk, "value");
        if (Array.isArray(chunkValue)) return chunkValue.join("");
      }
      return JSON.stringify(chunk);
    })
    .join("|")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^\(?current_timestamp\)?$/i.test(signature) ||
    signature.includes("strftime('%Y-%m-%dT%H:%M:%fZ','now')") ||
    signature ===
      `to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  ) {
    return "iso_utc_now";
  }
  return `sql:${signature}`;
}
