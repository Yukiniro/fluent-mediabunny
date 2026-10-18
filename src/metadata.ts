import type { MetadataTags } from "mediabunny";
import { MediaError, invalid } from "./errors.ts";
import { object } from "./config.ts";
import { metadataFields } from "./types.ts";
import type {
  Config,
  MetadataField,
  MetadataPatch,
  MetadataReport,
  MetadataValues,
} from "./types.ts";

export function dateValue(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))
    invalid("date must be a valid YYYY-MM-DD (years 0001–9999).");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    invalid("Invalid calendar date.");
  return date;
}
function validateValue(key: MetadataField, value: unknown): asserts value is string | null {
  if (value === null || value === "") return;
  if (typeof value !== "string" || value.includes("\0") || !value.isWellFormed())
    invalid(`Invalid metadata ${key}.`);
  if (key === "date") dateValue(value);
}
export function metadataPatch(value: unknown): MetadataPatch {
  if (value && typeof value === "object")
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !(metadataFields as readonly string[]).includes(key))
        throw new MediaError(
          "UNSUPPORTED_METADATA_FIELD",
          `Unsupported metadata field: ${String(key)}.`,
        );
    }
  const patch = object(value, metadataFields);
  for (const [key, item] of Object.entries(patch)) validateValue(key as MetadataField, item);
  return patch;
}
export function resolveMetadata(
  source: MetadataTags,
  instruction?: Config["metadata"],
): { tags: MetadataTags; report: MetadataReport } {
  const values: MetadataValues = {};
  const omittedSourceFields: string[] = [];
  const replacedSourceMetadata = instruction?.mode === "replace";
  const patch = instruction?.patch ?? {};
  if (!replacedSourceMetadata)
    for (const [key, raw] of Object.entries(source)) {
      if (raw === undefined) continue;
      if (!(metadataFields as readonly string[]).includes(key)) {
        omittedSourceFields.push(key);
        continue;
      }
      const field = key as MetadataField;
      if (patch[field] !== undefined) continue;
      try {
        const value: unknown =
          field === "date" && raw instanceof Date ? raw.toISOString().slice(0, 10) : raw;
        validateValue(field, value);
        if (value) values[field] = value;
      } catch {
        omittedSourceFields.push(key);
      }
    }
  const removedByUser: MetadataField[] = [];
  for (const field of metadataFields) {
    const value = patch[field];
    if (value === undefined) continue;
    if (value === null || value === "") {
      delete values[field];
      removedByUser.push(field);
    } else values[field] = value;
  }
  const { date, ...text } = values;
  const tags: MetadataTags = { ...text, ...(date ? { date: dateValue(date) } : {}) };
  return { tags, report: { values, omittedSourceFields, removedByUser, replacedSourceMetadata } };
}
