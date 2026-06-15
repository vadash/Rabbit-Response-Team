# 🐇 Rabbit-Response-Team <img width="505" height="360" alt="image" src="https://github.com/user-attachments/assets/cda304b5-0a16-437d-80c6-5ab662377e0c" />

[![Status: Active Development](https://img.shields.io/badge/Status-Active%20Development-orange.svg)](https://github.com/your-repo/CarrotKernel)
[![SillyTavern Extension](https://img.shields.io/badge/SillyTavern-Extension-blue.svg)](https://docs.sillytavern.app/)

*🎲 A random word generator designed to destabilize standard LLM pattern and probability-based thinking — fully offline.*

---

## 💭 The core issue

All LLMs run on **patterns** and **probabilities** — they predict what *should* come next, but never break from their training data.
Even when asked to "be random," they can't truly leave that internal loop — they're still inside the **fishbowl**. 🐠

---

## 🧠 Overview

The **Rabbit Response Team** breaks that loop.
It picks **truly random words** from a bundled offline word bank and **injects** them directly into the AI's prompt.
Each injected word must be used naturally in the model's response — forcing the AI to adapt, improvise, and escape pattern lock.

No network calls. No accounts. No API keys. Just words.

---

### ✨ Features

- 🎲 **Three Randomness Modes** — `random`, `double-pass` (anchor + associations), and `contextual` (keywords pulled from your latest message).
- 🌐 **English & Russian** — bundled word banks for both languages, plus an **Auto-detect** mode that picks per turn based on script.
- 🔁 **Synonym Scanner** — detects overused words in recent chat history and surfaces fresh alternatives.
- 🪶 **Prompt Injection** — words are spliced into the prompt at a configurable depth (system prompt vs. user-message boundary).
- 🚫 **Blacklist & History** — keep specific words out and avoid repeats within a configurable window.
- 🔧 **Custom Prompt Templates** — fully editable, with reset-to-default buttons.
- 📴 **Fully Offline** — runs entirely inside SillyTavern with zero runtime dependencies.

---

## 🧭 How to Use

### 1️⃣ Enable the Extension
- Go to **Extensions → Extension Settings**
- Find **🐇 Rabbit Response Team**
- Toggle the feature(s) you want (Random Words, Synonyms, or both)

### 2️⃣ Pick a Language Mode
- **English** — uses the EN word bank only.
- **Russian** — uses the RU word bank only.
- **Auto-detect** — picks per turn based on the script of your latest message.

### 3️⃣ Choose a Generation Mode
- **Random** — filtered sample (length, part of speech, blacklist, history).
- **Double-pass** — picks one anchor word with associations, then themes the remaining slots around it.
- **Contextual** — extracts keywords from your latest message and pulls in semantically related words.

### 4️⃣ Test It
Click **🎲 Test Random Words** to preview what the extension will inject.
Each test gives a *completely different* set of words.

### 5️⃣ Chat Normally
The injected words will appear invisibly in your prompt's backend,
and the AI will weave them naturally into its response.

---

## 🛠️ Developer Setup

```bash
git clone <this repo> into SillyTavern/public/extensions/third-party/
cd Rabbit-Response-Team
npm install        # devDependencies only (wordnet-db for the build pipeline)
npm test           # runs the node:test unit suite
npm run build      # rebuilds assets/{en,ru}/*.json from scripts/raw/
```

The extension runs directly in SillyTavern's client-side JavaScript environment — no bundler, no TypeScript.

### Regenerating Assets

Bundled word banks and synonym maps live under `assets/{en,ru}/`. To regenerate them from upstream sources (Datamuse wordfreq, `wordnet-db`, Badestrand Russian Dictionary, YARN), see [`scripts/raw/README.md`](scripts/raw/README.md) for download URLs, expected filenames, and SHA256 pins.

---

## 🧪 Try it out

It's a small experiment, but one I really believe will work! Let me know if you like it.

![Made with ❤️ (and carrotd!)](https://img.shields.io/badge/Made%20with-%E2%9D%A4-red)
