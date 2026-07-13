import fs from "node:fs/promises";
import path from "node:path";

function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("export ")) {
      line = line.slice("export ".length).trim();
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === "\"") {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
      }
    } else {
      const comment = value.search(/\s#/);
      if (comment >= 0) {
        value = value.slice(0, comment).trim();
      }
    }
    values[key] = value;
  }
  return values;
}

async function readDotenvFile(filePath: string): Promise<Record<string, string>> {
  try {
    return parseDotenv(await fs.readFile(filePath, "utf-8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function buildRuntimeEnv(
  projectRoot: string,
  overrides: Record<string, string> = {},
): Promise<NodeJS.ProcessEnv> {
  const dotenv = await readDotenvFile(path.join(projectRoot, ".env"));
  const dotenvLocal = await readDotenvFile(path.join(projectRoot, ".env.local"));
  return {
    ...process.env,
    ...dotenv,
    ...dotenvLocal,
    ...overrides,
  };
}
