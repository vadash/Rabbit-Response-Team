// Build a YARN-shape RU synonyms/associations file from RuWordNet + Badestrand.
//
// Sources (scripts/raw/):
//   rwn-synsets-{N,V,A}.xml      — RuWordNet synsets; all senses inside a
//                                   synset are synonyms of each other
//   rwn-senses-{N,V,A}.xml       — sense → synset mapping (gives word forms)
//   rwn-relations-N.xml          — hypernym/hyponym → association source
//   ru-verbs.csv                 — Badestrand "partner" column (aspectual
//                                   pairs); used as a fallback for verbs
//                                   not covered by RuWordNet
//
// Output (overwrites scripts/raw/yarn.json):
//   {
//     "synsets":  { "говорить": ["сказать", ...], ... },
//     "relations": { "дом": ["крыша", ...], ... }
//   }
//
// Filters: only single-word Russian lemmas (no spaces, pure Cyrillic after
// lowercasing). Multi-word phrases ("ВЫЧИТКА ТЕКСТА") are dropped.
//
// Usage: node scripts/prep/prep-yarn.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RAW = path.join(REPO_ROOT, "scripts", "raw");

const CYRILLIC_RE = /^[а-яё]+$/;

function normLemma(s) {
  return (s ?? "").toLowerCase().replace(/ё/g, "е").trim();
}

function attr(tag, name) {
  const re = new RegExp(`\\s${name}="([^"]*)"`);
  const m = tag.match(re);
  return m ? m[1] : null;
}

function parseXmlSenses(filePath) {
  // Returns Map<sense_id, { lemma, synset_id }>
  const out = new Map();
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, "utf-8");
  const re = /<sense\b([^>]*)\/>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const tagBody = m[1];
    const senseId = attr(tagBody, "id");
    const synsetId = attr(tagBody, "synset_id");
    const lemmaRaw = attr(tagBody, "lemma");
    if (!senseId || !synsetId || !lemmaRaw) continue;
    const lemma = normLemma(lemmaRaw);
    if (!lemma || !CYRILLIC_RE.test(lemma)) continue;
    out.set(senseId, { lemma, synsetId });
  }
  return out;
}

function parseXmlSynsets(filePath, senses) {
  // Returns Map<synset_id, string[]> of single-word lemmas in that synset.
  const out = new Map();
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, "utf-8");
  const synsetRe = /<synset\b[^>]*\bid="([^"]+)"/g;
  const positions = [];
  let m;
  while ((m = synsetRe.exec(text)) !== null) {
    positions.push({ id: m[1], start: m.index });
  }
  for (let i = 0; i < positions.length; i++) {
    const { id, start } = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1].start : text.length;
    const block = text.slice(start, end);
    const senseRe = /<sense\b[^>]*\bid="([^"]+)"/g;
    const lemmas = new Set();
    let sm;
    while ((sm = senseRe.exec(block)) !== null) {
      const sense = senses.get(sm[1]);
      if (sense) lemmas.add(sense.lemma);
    }
    if (lemmas.size > 0) out.set(id, Array.from(lemmas));
  }
  return out;
}

function parseXmlRelations(filePath) {
  // Returns Array<{ name, child_id, parent_id }>
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf-8");
  const out = [];
  const re = /<relation\b[^>]*\sname="([^"]+)"[^>]*\schild_id="([^"]+)"[^>]*\sparent_id="([^"]+)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ name: m[1], childId: m[2], parentId: m[3] });
  }
  return out;
}

// --- Load all RuWordNet data ---
console.error("Loading RuWordNet senses...");
const sensesN = parseXmlSenses(path.join(RAW, "rwn-senses-N.xml"));
const sensesV = parseXmlSenses(path.join(RAW, "rwn-senses-V.xml"));
const sensesA = parseXmlSenses(path.join(RAW, "rwn-senses-A.xml"));
const senses = new Map([...sensesN, ...sensesV, ...sensesA]);
console.error(`  ${senses.size} senses`);

console.error("Loading RuWordNet synsets...");
const synsetsN = parseXmlSynsets(path.join(RAW, "rwn-synsets-N.xml"), senses);
const synsetsV = parseXmlSynsets(path.join(RAW, "rwn-synsets-V.xml"), senses);
const synsetsA = parseXmlSynsets(path.join(RAW, "rwn-synsets-A.xml"), senses);
const synsets = new Map([...synsetsN, ...synsetsV, ...synsetsA]);
console.error(`  ${synsets.size} synsets`);

console.error("Loading RuWordNet relations (N only — associations source)...");
const relations = parseXmlRelations(path.join(RAW, "rwn-relations-N.xml"));
console.error(`  ${relations.length} relations`);

// --- Build synsets map (word → synonym list) ---
console.error("Building word → synonyms map...");
const synonymsMap = new Map();
for (const [, lemmas] of synsets) {
  if (lemmas.length < 2) continue;
  for (const w of lemmas) {
    const others = lemmas.filter(x => x !== w);
    const prev = synonymsMap.get(w) ?? [];
    for (const o of others) if (!prev.includes(o)) prev.push(o);
    synonymsMap.set(w, prev);
  }
}
console.error(`  ${synonymsMap.size} words with synonyms`);

// --- Build relations map (word → associations) ---
// Use hypernym/hyponym/related relations. Walk: word → its synsets → related
// synsets → their lemmas.
console.error("Building word → associations map...");
const wordToSynsets = new Map();
for (const [senseId, s] of senses) {
  const arr = wordToSynsets.get(s.lemma) ?? [];
  if (!arr.includes(s.synsetId)) arr.push(s.synsetId);
  wordToSynsets.set(s.lemma, arr);
}
const associationsMap = new Map();
const REL_KEEP = new Set(["hypernym", "hyponym", "related", "POS-synonymy"]);
for (const rel of relations) {
  if (!REL_KEEP.has(rel.name)) continue;
  const childSynset = synsets.get(rel.childId);
  const parentSynset = synsets.get(rel.parentId);
  if (!childSynset || !parentSynset) continue;
  for (const cw of childSynset) {
    const arr = associationsMap.get(cw) ?? [];
    for (const pw of parentSynset) {
      if (pw !== cw && !arr.includes(pw)) arr.push(pw);
    }
    associationsMap.set(cw, arr);
  }
  for (const pw of parentSynset) {
    const arr = associationsMap.get(pw) ?? [];
    for (const cw of childSynset) {
      if (cw !== pw && !arr.includes(cw)) arr.push(cw);
    }
    associationsMap.set(pw, arr);
  }
}
console.error(`  ${associationsMap.size} words with associations`);

// --- Merge in Badestrand verbs partner data (as fallback) ---
const verbsPath = path.join(RAW, "ru-verbs.csv");
if (fs.existsSync(verbsPath)) {
  console.error("Merging Badestrand verb partners...");
  const text = fs.readFileSync(verbsPath, "utf-8");
  const lines = text.split(/\r?\n/);
  const header = lines[0].split("\t");
  const partnerIdx = header.indexOf("partner");
  let added = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split("\t");
    const bare = normLemma(cols[0]);
    if (!bare || !CYRILLIC_RE.test(bare)) continue;
    const partnerRaw = cols[partnerIdx] ?? "";
    if (!partnerRaw || partnerRaw === "-") continue;
    const partners = partnerRaw
      .split(/[;,]/)
      .map(s => normLemma(s))
      .filter(p => p && p !== "-" && CYRILLIC_RE.test(p));
    if (partners.length === 0) continue;
    const prev = synonymsMap.get(bare) ?? [];
    for (const p of partners) {
      if (!prev.includes(p)) { prev.push(p); added++; }
      const pPrev = synonymsMap.get(p) ?? [];
      if (!pPrev.includes(bare)) pPrev.push(bare);
      synonymsMap.set(p, pPrev);
    }
    synonymsMap.set(bare, prev);
  }
  console.error(`  added ${added} verb-partner synonym edges`);
}

// --- Write yarn.json ---
const out = { synsets: {}, relations: {} };
for (const [w, syns] of synonymsMap) {
  if (syns.length > 0) out.synsets[w] = syns;
}
for (const [w, rels] of associationsMap) {
  if (rels.length > 0) out.relations[w] = rels;
}
fs.writeFileSync(path.join(RAW, "yarn.json"), JSON.stringify(out));
console.error(`Wrote yarn.json: ${Object.keys(out.synsets).length} synonym keys, ${Object.keys(out.relations).length} association keys`);
