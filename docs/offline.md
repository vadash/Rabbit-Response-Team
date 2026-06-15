With a 100–200 MB budget, you have more than enough room to build a completely offline, production-grade linguistic system. You do not need heavy AI models or runtime-heavy databases. Instead, you will use pre-filtered, highly compressed SQLite databases and JSON arrays running directly inside Node.js. [1] 
Here is the complete blueprint to build it.
------------------------------
## 1. The Tech Stack & Bundler Strategy
Because SillyTavern extensions run in a server-side Node.js environment (inside the SillyTavern/plugins/extensions directory), your bundler needs to target Node, not the browser.

* The Bundler: Use tsup (powered by esbuild). It requires zero configuration, bundles everything into a single file, minifies your code, and leaves your large asset files alone.
* Database Engine: Use better-sqlite3. It is written in C++ and is significantly faster than standard sqlite3 or JavaScript-based databases, achieving sub-millisecond lookups. Add it to external in your bundler configuration so it compiles correctly for the host system.

## Project File Structure

st-narrative-overdrive/
├── src/
│   ├── index.ts          # Extension entry point & SillyTavern hooks
│   ├── pipeline.ts       # Main logic (Double-pass, Contextual, Synonym scanner)
│   └── db.ts             # SQLite interaction wrapper
├── assets/
│   ├── en_words.json     # Wordbank, POS, and Ranks
│   ├── ru_words.json     # Wordbank, POS, and Ranks
│   └── linguistic_data.db # Unified SQLite database for Synonyms & Definitions
├── package.json
└── tsup.config.ts

## Bundler Configuration (tsup.config.ts)

import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],          // SillyTavern uses CommonJS for plugins
  target: 'node18',
  clean: true,
  minify: true,
  external: ['better-sqlite3'], // Don't bundle the native binary
  publicDir: 'assets',     // Automatically copies your json/db files to dist/
});

------------------------------
## 2. Sourcing and Preparing the Data
To fit within 200 MB, you cannot use raw data dumps. You must use python to parse, filter, and compile the raw assets into optimized production assets before packaging them.
## A. Core Word Banks (en_words.json, ru_words.json)

* English Source: Use the Datamuse Wordfreq dataset or the Google Books Ngram list. Filter for the top 30,000 words. Run them through a local script using the nltk Python package to attach POS tags.
* Russian Source: Use the [Badestrand Russian Dictionary JSON](https://github.com/Badestrand/russian-dictionary). It contains frequency ranks and explicit POS tags (Noun, Verb, Adjective, Adverb) natively.
* Optimization: Format your final JSON files as compact nested arrays instead of objects to save space.

[
  ["apple", "noun", 1420],
  ["run", "verb", 512]
]

Size Impact: ~1.5 MB for English, ~1.8 MB for Russian.

## B. Contextual Mode, Synonyms, & Definitions (linguistic_data.db)
Instead of hundreds of JSON files, use a single SQLite database with index structures.

* English Definitions & Synonyms: Download the raw JSON English dictionary dump from Kaikki.org (based on Wiktionary).
* Russian Definitions & Synonyms: Download the Russian JSON dictionary dump from Kaikki.org.
* Contextual Associations: Download WordNet (Princeton) for English, and RuWordNet or Yarn for Russian.

## The Python Pre-Processing Script
Write a quick script to parse these files and write them into a single linguistic_data.db file. Clean the data using these rules:

   1. Strip all HTML, Markdown, and secondary definitions. Keep only the first sentence of the primary definition.
   2. Store synonyms as comma-separated strings.
   3. Establish your schema:

CREATE TABLE words (
    id INTEGER PRIMARY KEY,
    lang TEXT,          -- 'en' or 'ru'
    word TEXT,
    definition TEXT,
    synonyms TEXT,      -- "word1,word2,word3"
    associations TEXT   -- "related1,related2" (For Contextual Mode)
);CREATE INDEX idx_word_lang ON words(word, lang);

Size Impact: A combined English/Russian dictionary stripped to essentials takes up roughly 80–110 MB. It easily fits your budget while providing blistering query speeds.
------------------------------
## 3. Implementing the Offline Features Step-by-Step
With your assets packed, here is how the core architecture maps to your pipeline functions.
## Step 1: Initialize the Database (src/db.ts)

import Database from 'better-sqlite3';import path from 'path';
// Path points to the public asset folder copied by tsupconst dbPath = path.join(__dirname, 'linguistic_data.db');const db = new Database(dbPath, { readonly: true });
export interface WordMetadata {
  definition: string;
  synonyms: string[];
  associations: string[];
}
export function lookupWord(word: string, lang: 'en' | 'ru'): WordMetadata | null {
  const stmt = db.prepare('SELECT definition, synonyms, associations FROM words WHERE word = ? AND lang = ?');
  const row = stmt.get(word.toLowerCase(), lang) as any;
  if (!row) return null;

  return {
    definition: row.definition,
    synonyms: row.synonyms ? row.synonyms.split(',') : [],
    associations: row.associations ? row.associations.split(',') : []
  };
}

## Step 2: Language Detection & Core Word Selection
When CHAT_COMPLETION_PROMPT_READY fires, inspect the last user message. Use a fast regular expression to check for Cyrillic characters to determine the language.

import enWords from '../assets/en_words.json';import ruWords from '../assets/ru_words.json';
function detectLanguage(text: string): 'en' | 'ru' {
  const cyrillicPattern = /[\u0400-\u04FF]/;
  return cyrillicPattern.test(text) ? 'ru' : 'en';
}
export function getRandomWords(lang: 'en' | 'ru', config: { count: number; pos?: string; minRank: number; maxRank: number; blacklist: Set<string> }): string[] {
  const wordBank = lang === 'en' ? enWords : ruWords;
  
  // Filter based on configuration arrays
  const filtered = wordBank.filter(([word, pos, rank]) => {
    if (config.pos && pos !== config.pos) return false;
    if (rank < config.minRank || rank > config.maxRank) return false;
    if (config.blacklist.has(word as string)) return false;
    return true;
  });

  // Shuffle and slice
  const result: string[] = [];
  const pool = [...filtered];
  while (result.length < config.count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(index, 1)[0][0] as string);
  }
  return result;
}

## Step 3: Processing Advanced Modes (Contextual & Double-Pass)

* Contextual Mode: Tokenize the incoming user message using a basic regex split. Loop backward through the words. Check the SQLite database via lookupWord(). Stop at the first word that yields an entry containing data in the associations field, and pull your X words from that list.
* Double-Pass Mode: Call getRandomWords() setting count: 1 to secure a seed word. Instantly pass that seed word to lookupWord(). Extract its associations or synonyms array, and populate the remaining word slots from that array.

## Step 4: Synonym Subsystem (The Overuse Scanner)

   1. Read the past 5-10 messages from the SillyTavern chat history array.
   2. Lowercase and split the text into raw words, ignoring common structural grammar (stop words like the, a, и, в, на).
   3. Build an in-memory frequency map (Map<string, number>).
   4. Identify any keyword used more than 3 times.
   5. Query lookupWord(overusedWord, lang). If synonyms exist, select the top 2 alternatives and seamlessly format them into your OOC template:
   "Additionally, the user is overusing the word '${word}'. Try substituting it with: ${synonyms.slice(0,2).join(', ')}."

------------------------------
## 4. Bundling and Distribution Flow
When your coding is complete, the final deployment workflow follows this sequence:

   1. Build Phase: Run tsup. This creates a dist/ directory containing a tiny, single-file JavaScript engine (index.js), your highly compressed linguistic_data.db, and your target language word banks.
   2. SillyTavern Integration: SillyTavern reads your index.js, registers your listener to the prompt pipeline, and boots instantly. Because your lookups evaluate natively inside memory maps and indexed SQLite blocks, your extension introduces zero perceptible stutter to the typing environment.

---

When a user installs a third-party extension in SillyTavern using a GitHub URL, SillyTavern clones your repository directly into its local file structure. Because it fetches your repository using a standard git clone command, the build artifacts and database files must already exist inside your repository. [1, 2, 3, 4, 5] 
The end-user will not run your bundler or execute compilation scripts—you must do that before pushing your code to GitHub.
------------------------------
## 1. The GitHub Repository Structure (What to Push)
To make it compatible with SillyTavern's automatic git installation, you cannot just push your source code. You must commit your compiled dist directory and assets. Your final GitHub repository must look exactly like this:

your-repo-name/
├── manifest.json       # CRITICAL: Tells ST where to find your code
├── index.js            # Entry point (Your bundled, main code)
├── assets/
│   ├── en_words.json   # Processed wordbank array
│   ├── ru_words.json   # Processed wordbank array
│   └── linguistic_data.db # The 100MB SQLite database
└── README.md

Note: You can keep your src/ folder, package.json, and tsup.config.ts in the repository for transparency, but SillyTavern only cares about manifest.json, index.js, and your assets/ folder. [1] 
------------------------------
## 2. The manifest.json File
SillyTavern reads this file the moment the git clone finishes. Create a file named manifest.json in the root of your repository: [1, 5] 

{
  "name": "st-narrative-overdrive",
  "label": "Narrative Overdrive (Offline)",
  "description": "Invisible OOC random word and contextual themes injector for EN and RU. 100% Offline.",
  "version": "1.0.0",
  "author": "YourName",
  "entryPoint": "index.js",
  "jsMode": "node",
  "requires": []
}


* entryPoint: Tells SillyTavern to execute your bundled index.js.
* jsMode: Explicitly set to "node" so SillyTavern executes it within the server-side Node.js environment, allowing the better-sqlite3 file lookups to work. [1] 

------------------------------
## 3. Your Build and Push Workflow (As a Developer)
Because the extension uses a 100 MB database, you cannot rely on runtime downloads. Follow this exact workflow every time you update your extension:

   1. Generate Data: Run your local Python preprocessing script to build linguistic_data.db and your word arrays.
   2. Move to Assets: Move the .db and .json files into your project's /assets directory.
   3. Compile: Run npm run build (which calls tsup). This compiles your TypeScript down into a single index.js file in your root folder and moves your assets over.
   4. Commit Large Files: Ensure your .gitignore does not block .db or .json files. Since GitHub has a strict 100 MB single-file limit, make sure your final linguistic_data.db is compressed to roughly 70–90 MB. If it hits 101 MB, GitHub will reject the push unless you use Git LFS (which can make automatic ST installation messy). Keep definitions concise to stay safely under 95 MB.
   5. Push to GitHub: Push all artifacts (index.js, manifest.json, and assets/) to your public repository. [1] 

------------------------------
## 4. How the End-User Installs It
Once your repository is configured with the compiled files, the user follows these steps:

   1. Open SillyTavern and click the Extensions (stacked cubes/plug) icon at the top of the interface.
   2. Click on the Download Extensions & Assets menu.
   3. Locate the box labeled Install Extension or Import third-party extension from Git URL.
   4. Paste your public GitHub repository link (e.g., https://github.com) and hit enter.
   5. SillyTavern downloads the repository via Git. Because the code is already pre-bundled and the database is included, the extension will appear instantly in their menu.
   6. The user checks the box to enable it, and it begins intercepting the prompt pipeline immediately. [2, 6, 7, 8, 9] 
