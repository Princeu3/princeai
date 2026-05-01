import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

export interface Config {
  host: string;
  port: number;
  claudeBinary: string;
  dataDir: string;
  dbPath: string;
  webDistDir: string;
}

function envOrDefault(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.length > 0 ? v : fallback;
}

function envPortOrDefault(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Default data dir lives inside the repo so it works in sandboxed envs.
// Override with CCWEB_DATA_DIR.
const here = dirname(fileURLToPath(import.meta.url));
// here = <repo>/server/src → two levels up is the repo root.
const repoRoot = join(here, "..", "..");
const defaultDataDir = join(repoRoot, "data");
const dataDir = envOrDefault("CCWEB_DATA_DIR", defaultDataDir);
mkdirSync(dataDir, { recursive: true });

export const config: Config = {
  host: envOrDefault("CCWEB_HOST", "127.0.0.1"),
  port: envPortOrDefault("CCWEB_PORT", 4131),
  claudeBinary: envOrDefault("CCWEB_CLAUDE_BIN", "claude"),
  dataDir,
  dbPath: join(dataDir, "metadata.sqlite"),
  webDistDir: join(repoRoot, "web", "dist"),
};
