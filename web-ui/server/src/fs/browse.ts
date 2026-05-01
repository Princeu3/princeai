/**
 * Directory browser rooted at $HOME. Used by the new-session modal.
 *
 * Rules:
 *  - `path` must be absolute and resolve under $HOME.
 *  - `..` traversal is rejected via realpath containment check.
 *  - Hidden entries (`.`-prefixed) are excluded except for `.claude`.
 *  - Files are listed (for visibility) but callers typically only let the
 *    user select directories.
 */

import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, dirname, basename } from "node:path";
import type { FsListResponse, FsEntry } from "@ccweb/shared";

const HOME = homedir();

export async function browse(rawPath: string): Promise<FsListResponse> {
  const path = resolve(rawPath);
  const real = await realpath(path).catch(() => {
    throw new Error(`path does not exist: ${path}`);
  });
  if (!real.startsWith(HOME)) {
    throw new Error(`path escapes $HOME: ${real}`);
  }
  const st = await stat(real);
  if (!st.isDirectory()) {
    throw new Error(`not a directory: ${real}`);
  }

  const names = await readdir(real);
  const visible = names.filter((n) => !n.startsWith(".") || n === ".claude");

  const entries: FsEntry[] = [];
  for (const name of visible) {
    const full = resolve(real, name);
    try {
      const s = await stat(full);
      if (s.isDirectory()) {
        entries.push({ name, type: "dir" });
      } else if (s.isFile()) {
        entries.push({ name, type: "file", size: s.size });
      }
    } catch {
      // broken symlink or permission error — skip
    }
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const parent = real === HOME ? null : dirname(real);
  return {
    path: real,
    parent,
    entries,
  };
}

export function getHome(): string {
  return HOME;
}
