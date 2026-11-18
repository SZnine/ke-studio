import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";

/** Fingerprints only: shipped code stays in Git history, never in the application bundle. */
export async function languageDefaults() {
  const versions = {};
  for (const name of (await fs.readdir("studio/language")).sort()) {
    const text = (await fs.readFile("studio/language/" + name, "utf8")).replace(
      /\r\n/g,
      "\n",
    );
    const hash = createHash("sha1")
      .update(`blob ${Buffer.byteLength(text)}\0`)
      .update(text)
      .digest("hex");
    versions[name] = new Set([hash]);
  }
  // A source archive without Git can still track the current defaults for future updates.
  let objects = "";
  try {
    objects = execFileSync(
      "git",
      ["rev-list", "--objects", "HEAD", "--", "studio/language"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {}
  for (const line of objects.split("\n")) {
    const match = line.match(/^([a-f0-9]{40}) studio\/language\/([^/]+)$/);
    if (match && versions[match[2]]) versions[match[2]].add(match[1]);
  }
  return Object.fromEntries(
    Object.entries(versions).map(([name, hashes]) => [
      name,
      [...hashes].sort(),
    ]),
  );
}
