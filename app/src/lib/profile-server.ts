import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { resolveProjectRoot } from "@/lib/review-store";

function parseTomlValue(raw: string): unknown {
  const value = raw.trim();
  if (value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replace(/\\"/g, "\"");
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item));
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : value;
}

function parseSimpleToml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let section: Record<string, unknown> = result;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const sectionMatch = /^\[([A-Za-z0-9_.-]+)\]$/.exec(trimmed);
    if (sectionMatch) {
      const parts = sectionMatch[1].split(".");
      section = result;
      for (const part of parts) {
        const existing = section[part];
        if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
          section[part] = {};
        }
        section = section[part] as Record<string, unknown>;
      }
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(trimmed);
    if (kv) {
      section[kv[1]] = parseTomlValue(kv[2]);
    }
  }
  return result;
}

function profileDir(profileName = "serious_science"): string {
  return path.join(resolveProjectRoot(), "profiles", profileName);
}

export async function readProfileBase(profileName = "serious_science"): Promise<Record<string, unknown>> {
  try {
    const text = await fs.readFile(path.join(profileDir(profileName), "profile.toml"), "utf-8");
    return parseSimpleToml(text);
  } catch {
    return {};
  }
}

export async function readProfileOverrides(profileName = "serious_science"): Promise<Record<string, unknown>> {
  const filePath = path.join(profileDir(profileName), "profile_overrides.json");
  try {
    if (!existsSync(filePath)) {
      return {};
    }
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}
