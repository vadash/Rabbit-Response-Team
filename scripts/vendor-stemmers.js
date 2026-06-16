// Vendor Porter (EN) and Snowball RU stemmers into self-contained ESM files
// under src/util/. Reads the installed devDependency sources from node_modules/,
// wraps them with a license header + @vendored-from marker, and re-exports
// a single `stem(word)` function so no project code touches node_modules paths.
//
// Idempotent: re-running with the same source versions produces byte-identical
// output. Exits non-zero with a clear "run npm install" message if node_modules
// is missing — never silently ships an un-stemmed asset.
//
// Wired into `npm run build` as the first step (see package.json).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NODE_MODULES = path.join(ROOT, "node_modules");
const SRC_UTIL = path.join(ROOT, "src", "util");

const SOURCES = [
  {
    pkgDir: "porter-stemmer",
    pkgName: "porter-stemmer",
    entry: "porter.js",
    licenseFile: "LICENSE",
    outName: "porter.js",
    wrapper: wrapPorter,
  },
  {
    pkgDir: "snowball-stemmer.jsx",
    pkgName: "snowball-stemmer.jsx",
    entry: path.join("dest", "russian-stemmer.common.js"),
    licenseFile: "LICENSE.md",
    outName: "snowball-ru.js",
    wrapper: wrapRussian,
  },
];

function readPkgVersion(pkgDir) {
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(NODE_MODULES, pkgDir, "package.json"), "utf8"),
  );
  return pkgJson.version;
}

function readLicense(pkgDir, licenseFile) {
  const licensePath = path.join(NODE_MODULES, pkgDir, licenseFile);
  if (!fs.existsSync(licensePath)) {
    throw new Error(`License file not found: ${licensePath}`);
  }
  return fs.readFileSync(licensePath, "utf8").trimEnd();
}

function buildHeader(pkgName, version, license) {
  const lines = [
    "// VENDORED — DO NOT EDIT BY HAND.",
    "// Produced by `node scripts/vendor-stemmers.js` from the listed npm package.",
    `// @vendored-from: ${pkgName}@${version}`,
    "//",
    "// Original license follows:",
    "//",
  ];
  for (const ln of license.split(/\r?\n/)) {
    lines.push(`// ${ln}`);
  }
  return lines.join("\n") + "\n";
}

// Porter source: an IIFE that conditionally writes `exports.stemmer` when an
// `exports` object exists in scope. We declare a synthetic `exports` so the
// IIFE populates it, then expose `stem(word)` over the named function.
function wrapPorter(sourceBody, pkgName, version, license) {
  const header = buildHeader(pkgName, version, license);
  return (
    header +
    "\n" +
    "var module = { exports: {} };\n" +
    "var exports = module.exports;\n\n" +
    sourceBody.trimEnd() +
    "\n\n" +
    "var __porterStemmer = module.exports.stemmer;\n\n" +
    "/**\n" +
    " * Porter stemmer. Reduce an English word to its stem.\n" +
    " * @param {string} word\n" +
    " * @returns {string}\n" +
    " */\n" +
    "export function stem(word) {\n" +
    "  return __porterStemmer(String(word));\n" +
    "}\n"
  );
}

// Russian source: an IIFE that registers classes on a top-level `JSX` object
// and then writes them to `exports`. Same synthetic-exports trick as Porter;
// we then instantiate `RussianStemmer` and expose `stem(word)` over its
// `stemWord` method.
function wrapRussian(sourceBody, pkgName, version, license) {
  const header = buildHeader(pkgName, version, license);
  return (
    header +
    "\n" +
    "var module = { exports: {} };\n" +
    "var exports = module.exports;\n\n" +
    sourceBody.trimEnd() +
    "\n\n" +
    "var __RussianStemmer = module.exports.RussianStemmer;\n" +
    "var __instance = new __RussianStemmer();\n\n" +
    "/**\n" +
    " * Snowball Russian stemmer. Reduce a Russian word to its stem.\n" +
    " * Input is expected to be lowercase; callers should normalise ё→е first.\n" +
    " * @param {string} word\n" +
    " * @returns {string}\n" +
    " */\n" +
    "export function stem(word) {\n" +
    "  return __instance.stemWord(String(word));\n" +
    "}\n"
  );
}

function ensureNodeModules() {
  if (!fs.existsSync(NODE_MODULES)) {
    console.error(
      "node_modules/ not found. Run `npm install` before vendoring stemmers.",
    );
    process.exit(1);
  }
}

function ensureOutputDir() {
  fs.mkdirSync(SRC_UTIL, { recursive: true });
}

function vendorOne(spec) {
  const { pkgDir, pkgName, entry, licenseFile, outName, wrapper } = spec;
  const sourcePath = path.join(NODE_MODULES, pkgDir, entry);
  if (!fs.existsSync(sourcePath)) {
    console.error(
      `Missing source for ${pkgName}: ${sourcePath}. Run \`npm install\`.`,
    );
    process.exit(1);
  }
  const version = readPkgVersion(pkgDir);
  const license = readLicense(pkgDir, licenseFile);
  const sourceBody = fs.readFileSync(sourcePath, "utf8");
  const output = wrapper(sourceBody, pkgName, version, license);
  const outPath = path.join(SRC_UTIL, outName);
  fs.writeFileSync(outPath, output, "utf8");
  return { outPath, pkgName, version };
}

function main() {
  ensureNodeModules();
  ensureOutputDir();
  const results = SOURCES.map(vendorOne);
  for (const r of results) {
    console.log(
      `vendored ${r.pkgName}@${r.version} -> ${path.relative(ROOT, r.outPath)}`,
    );
  }
}

main();
