// HTML string templates for the settings panel.
// Per design §8 (ui/templates.js). Pure functions: take settings, return HTML.
// No imports of engine or data layers — UI never imports engine (design §4 dependency rule).

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeTextarea(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const LANG_OPTIONS = [
  { value: "en", label: "🇬🇧 English" },
  { value: "ru", label: "🇷🇺 Russian" },
  { value: "auto", label: "🌐 Auto-detect" },
];

export function languageRadio(settings) {
  const current = settings?.language ?? "auto";
  const radios = LANG_OPTIONS.map((opt) => {
    const checked = current === opt.value ? "checked" : "";
    return `
      <label class="rabbit-lang-option">
        <input type="radio" name="rabbit_language" value="${opt.value}" ${checked} />
        <span>${opt.label}</span>
      </label>`;
  }).join("");

  return `
    <div class="rabbit-setting-row rabbit-language-row">
      <label>Language Mode</label>
      <div class="rabbit-lang-radio">${radios}</div>
      <small>Auto-detect picks the dominant script of each user message.</small>
    </div>`;
}

export function randomWordsSection(settings) {
  const rw = settings?.randomWords ?? {};
  const pos = rw.partsOfSpeech ?? { noun: true, verb: true, adjective: true, adverb: false };
  const wordCount = rw.wordCount ?? 3;
  const wordLength = rw.wordLength ?? 0;
  const mode = rw.mode ?? "random";
  const enabled = rw.enabled ? "checked" : "";
  const themeWords = escapeHtml(rw.themeWords ?? "");
  const customPrompt = escapeTextarea(rw.customPrompt ?? "");
  const injectionDepth = rw.injectionDepth ?? 0;
  const injectionEndRole = rw.injectionEndRole ?? "system";
  const blacklist = escapeTextarea(Array.isArray(rw.blacklist) ? rw.blacklist.join(", ") : "");
  const historySize = rw.wordHistorySize ?? 50;

  return `
    <div id="rabbit-tab-random" class="rabbit-tab-content">
      <div class="rabbit-setting-row">
        <label for="rabbit_random_enabled" style="display: flex; align-items: center; justify-content: space-between;">
          <span>Enable Random Words</span>
          <label class="rabbit-toggle-switch">
            <input type="checkbox" id="rabbit_random_enabled" name="rabbit_random_enabled" ${enabled} />
            <span class="rabbit-toggle-slider"></span>
          </label>
        </label>
      </div>

      <div class="rabbit-setting-row">
        <label for="rabbit_word_count">
          Number of Random Words: <span id="rabbit_word_count_value">${wordCount}</span>
        </label>
        <input type="range" id="rabbit_word_count" name="rabbit_word_count"
               min="1" max="10" value="${wordCount}" step="1" />
      </div>

      <div class="rabbit-setting-row">
        <label for="rabbit_mode">Word Selection Mode:</label>
        <select id="rabbit_mode" name="rabbit_mode">
          <option value="random" ${mode === "random" ? "selected" : ""}>True Random</option>
          <option value="double-pass" ${mode === "double-pass" ? "selected" : ""}>Double Pass (themed around an anchor)</option>
          <option value="contextual" ${mode === "contextual" ? "selected" : ""}>Contextual (from your message)</option>
        </select>
        <small>
          Random: completely random words |
          Double Pass: one anchor plus its thematic associations |
          Contextual: words related to keywords in your last message
        </small>
      </div>

      <div class="rabbit-setting-row">
        <label for="rabbit_word_length">
          Word Length: <span id="rabbit_word_length_value">${wordLength === 0 ? "Any" : wordLength}</span>
        </label>
        <input type="range" id="rabbit_word_length" name="rabbit_word_length"
               min="0" max="12" value="${wordLength}" step="1" />
        <small>0 = Any length, 1-12 = specific letter count</small>
      </div>

      <div class="rabbit-setting-row">
        <label>Part of Speech:</label>
        <fieldset class="rabbit-pos-fieldset">
          <label><input type="checkbox" id="rabbit_pos_noun" name="rabbit_pos_noun" ${pos.noun ? "checked" : ""} /> Nouns</label>
          <label><input type="checkbox" id="rabbit_pos_verb" name="rabbit_pos_verb" ${pos.verb ? "checked" : ""} /> Verbs</label>
          <label><input type="checkbox" id="rabbit_pos_adj" name="rabbit_pos_adj" ${pos.adjective ? "checked" : ""} /> Adjectives</label>
          <label><input type="checkbox" id="rabbit_pos_adv" name="rabbit_pos_adv" ${pos.adverb ? "checked" : ""} /> Adverbs</label>
        </fieldset>
      </div>

      <div class="rabbit-setting-row">
        <label for="rabbit_theme_words">Theme Words (optional):</label>
        <input type="text" id="rabbit_theme_words" name="rabbit_theme_words"
               value="${themeWords}"
               placeholder="e.g., ocean, adventure, mystery" />
        <small>Up to 5 comma-separated theme words (used by Double Pass / Contextual modes).</small>
      </div>

      <div class="rabbit-setting-row">
        <button id="rabbit_test" type="button" class="rabbit-test-button">🎲 Test Random Words</button>
      </div>

      <div class="rabbit-advanced-header" data-target="#rabbit-random-advanced-body" aria-expanded="false">
        <i class="fa-solid fa-cog"></i>
        <span>Advanced Settings</span>
        <i class="fa-solid fa-chevron-down rabbit-advanced-toggle"></i>
      </div>

      <div id="rabbit-random-advanced-body" class="rabbit-advanced-body" style="display: none;">
        <div class="rabbit-setting-row">
          <label for="rabbit_custom_prompt">Custom Prompt Template:</label>
          <textarea id="rabbit_custom_prompt" name="rabbit_custom_prompt" rows="4">${customPrompt}</textarea>
          <small>Use <code>{{words}}</code> to insert the generated words.</small>
        </div>

        <div class="rabbit-setting-row">
          <label for="rabbit_injection_depth">Injection Depth:</label>
          <input type="number" id="rabbit_injection_depth" name="rabbit_injection_depth"
                 min="0" max="50" value="${injectionDepth}" />
          <small>0 = just before assistant prefill, higher = further up the prompt.</small>
        </div>

        <div class="rabbit-setting-row">
          <label for="rabbit_injection_end_role">Injection Role:</label>
          <select id="rabbit_injection_end_role" name="rabbit_injection_end_role">
            <option value="system" ${injectionEndRole === "system" ? "selected" : ""}>System</option>
            <option value="user" ${injectionEndRole === "user" ? "selected" : ""}>User</option>
            <option value="assistant" ${injectionEndRole === "assistant" ? "selected" : ""}>Assistant</option>
          </select>
        </div>

        <div class="rabbit-setting-row">
          <label for="rabbit_word_blacklist">Word Blacklist:</label>
          <textarea id="rabbit_word_blacklist" name="rabbit_word_blacklist" rows="2"
                    placeholder="e.g., inappropriate, complex, difficult">${blacklist}</textarea>
          <small>Comma-separated list of words to never inject (case-insensitive).</small>
        </div>

        <div class="rabbit-setting-row">
          <label for="rabbit_history_size">Word History Size:</label>
          <input type="number" id="rabbit_history_size" name="rabbit_history_size"
                 min="0" max="100" value="${historySize}" />
          <small>Track recently used words to avoid repeats (0 = disabled).</small>
        </div>

        <div class="rabbit-setting-row">
          <button id="rabbit_reset_prompt" type="button" class="rabbit-reset-button">
            <i class="fa-solid fa-rotate-left"></i> Reset to Default Template
          </button>
        </div>
      </div>
    </div>`;
}

export function synonymsSection(settings) {
  const syn = settings?.synonyms ?? {};
  const enabled = syn.enabled ? "checked" : "";
  const scanDepth = syn.scanDepth ?? 6;
  const minOccurrences = syn.minOccurrences ?? 3;
  const customPrompt = escapeTextarea(syn.customPrompt ?? "");

  return `
    <div id="rabbit-tab-synonyms" class="rabbit-tab-content" style="display: none;">
      <div class="rabbit-setting-row">
        <label for="rabbit_synonym_enabled" style="display: flex; align-items: center; justify-content: space-between;">
          <span>Enable Synonyms</span>
          <label class="rabbit-toggle-switch">
            <input type="checkbox" id="rabbit_synonym_enabled" name="rabbit_synonym_enabled" ${enabled} />
            <span class="rabbit-toggle-slider"></span>
          </label>
        </label>
        <small>Detect overused words in recent chat history and suggest synonyms for variety.</small>
      </div>

      <div class="rabbit-setting-row">
        <label for="rabbit_scan_depth">Scan Depth (messages):</label>
        <input type="number" id="rabbit_scan_depth" name="rabbit_scan_depth"
               min="1" max="20" value="${scanDepth}" />
        <small>How many recent messages to analyze for word frequency.</small>
      </div>

      <div class="rabbit-setting-row">
        <label for="rabbit_min_occurrences">Minimum Occurrences:</label>
        <input type="number" id="rabbit_min_occurrences" name="rabbit_min_occurrences"
               min="2" max="10" value="${minOccurrences}" />
        <small>Word must appear this many times to trigger a synonym suggestion.</small>
      </div>

      <div class="rabbit-advanced-header" data-target="#rabbit-synonym-advanced-body" aria-expanded="false">
        <i class="fa-solid fa-cog"></i>
        <span>Advanced Settings</span>
        <i class="fa-solid fa-chevron-down rabbit-advanced-toggle"></i>
      </div>

      <div id="rabbit-synonym-advanced-body" class="rabbit-advanced-body" style="display: none;">
        <div class="rabbit-setting-row">
          <label for="rabbit_synonym_prompt">Custom Prompt Template:</label>
          <textarea id="rabbit_synonym_prompt" name="rabbit_synonym_prompt" rows="4">${customPrompt}</textarea>
          <small>Use <code>{{originalWord}}</code> and <code>{{synonyms}}</code> macros.</small>
        </div>

        <div class="rabbit-setting-row">
          <button id="rabbit_synonym_reset_prompt" type="button" class="rabbit-reset-button">
            <i class="fa-solid fa-rotate-left"></i> Reset to Default Template
          </button>
        </div>
      </div>
    </div>`;
}

export function panelShell({ randomWords, synonyms, language }) {
  return `
    <div class="rabbit-numeral-container">
      <div class="rabbit-header" data-target="#rabbit-settings-body" aria-expanded="true">
        <div class="rabbit-header-icon">🐰</div>
        <h3 class="rabbit-header-title">Rabbit Response Team</h3>
        <div class="rabbit-header-toggle">
          <i class="fa-solid fa-chevron-down"></i>
        </div>
      </div>
      <div id="rabbit-settings-body" class="rabbit-settings-body">
        <p class="rabbit-description">
          Two offline features: inject random words, or suggest synonyms for overused words.
        </p>

        ${languageRadio({ language })}

        <div class="rabbit-tabs">
          <button type="button" class="rabbit-tab-button active" data-tab="random">Random Words</button>
          <button type="button" class="rabbit-tab-button" data-tab="synonyms">Synonyms</button>
        </div>

        ${randomWordsSection({ randomWords })}
        ${synonymsSection({ synonyms })}
      </div>
    </div>`;
}
