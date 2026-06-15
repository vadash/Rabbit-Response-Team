// Atomic JSON write — writes to a temp file then renames, so interrupted
// builds don't leave half-written JSON.
//
// Uses node:fs + node:crypto so it works in Node 18+ without dependencies.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Write `data` as JSON to `targetPath` atomically.
 * @param {string} targetPath — absolute or relative path to the destination file
 * @param {unknown} data — value to serialize with JSON.stringify
 */
export function writeJsonAtomic(targetPath, data) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpName = `.tmp-${crypto.randomUUID()}.json`;
  const tmpPath = path.join(dir, tmpName);

  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data), "utf-8");
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}
