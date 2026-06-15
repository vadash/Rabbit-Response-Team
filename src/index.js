// SillyTavern extension entry point.
// Per design §4 (file structure), §8 (src/index.js interface), §9.1 (init
// sequence), §9.3 (failure modes). Wires ST globals into the settings,
// data, engine, and ui layers and registers the CHAT_COMPLETION_PROMPT_READY
// listener. Asset loading stays lazy per §9.2 — nothing is fetched at boot.
//
// Root index.js re-exports this module so manifest.json's `js: "index.js"`
// keeps pointing at the file ST has always loaded.

import { saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import {
  loadSettings,
  __setDepsForTest as setSettingsDeps,
} from './settings.js';
import {
  ensureWordBankLoaded,
  getWordBank,
  sampleWords,
  getWordMeta,
} from './data/words.js';
import {
  ensureSynonymsLoaded,
  getSynonyms,
  getAssociations,
  hasEntry,
} from './data/synonyms.js';
import { resolveLanguage } from './data/language.js';
import { generateWords } from './engine/random-words.js';
import {
  onPromptReady,
  __setDepsForTest as setInjectorDeps,
} from './engine/injector.js';
import {
  renderSettings,
  bindEvents,
  __setDepsForTest as setPanelDeps,
} from './ui/panel.js';

const EXTENSION_NAME = 'rabbit-response-team';

// Track whether we've already surfaced an asset-load failure this session.
// §9.3 says "toastr.error once" — the user shouldn't see a toast on every
// chat turn after the data has gone missing.
let assetFailureAnnounced = false;

function announceFailure(message) {
  if (assetFailureAnnounced) return;
  assetFailureAnnounced = true;
  try {
    const { toastr } = SillyTavern.getContext();
    if (toastr?.error) toastr.error(message, 'Rabbit Response Team');
  } catch {
    // SillyTavern context not available — nothing more we can do.
  }
  // eslint-disable-next-line no-console
  console.warn(`Rabbit Response Team: ${message}`);
}

// Lazy-load the asset bundles for the resolved language on the first chat
// turn that actually needs them (§9.2). Both languages are loaded under
// 'auto' so the resolved-language lookup never blocks on a second fetch.
async function ensureAssetsForLanguage(lang) {
  const langs = lang === 'auto' ? ['en', 'ru'] : [lang];
  await Promise.all(
    langs.map(async (l) => {
      try {
        await ensureWordBankLoaded(l);
        await ensureSynonymsLoaded(l);
      } catch (err) {
        announceFailure(`Offline word data failed to load (${l}).`);
        throw err;
      }
    }),
  );
}

// Wrap onPromptReady so the lazy asset load + one-time toastr live here in
// the entry point, keeping the injector focused on prompt mutation.
async function handlePromptReady(promptData) {
  try {
    const settings = loadSettings();
    const rwEnabled = !!settings?.randomWords?.enabled;
    const synEnabled = !!settings?.synonyms?.enabled;
    if (!rwEnabled && !synEnabled) return promptData;

    // Resolve language the same way the injector will, so we only fetch the
    // bundle we actually need.
    const { chat } = SillyTavern.getContext?.() ?? {};
    const lastUser =
      Array.isArray(chat) && chat.length
        ? (chat.slice().reverse().find((m) => m?.is_user)?.mes ?? '')
        : '';
    const resolved = resolveLanguage(settings.language || 'auto', lastUser);

    await ensureAssetsForLanguage(resolved);
  } catch {
    // Already announced via announceFailure; injector will no-op cleanly.
  }
  return onPromptReady(promptData);
}

function registerEventListener() {
  const { eventSource, event_types } = SillyTavern.getContext();
  if (!eventSource || !event_types) {
    console.warn('Rabbit Response Team: SillyTavern event bus unavailable.');
    return;
  }
  const type = event_types.CHAT_COMPLETION_PROMPT_READY;
  if (!type) {
    console.warn(
      'Rabbit Response Team: CHAT_COMPLETION_PROMPT_READY not found in event_types.',
    );
    return;
  }
  eventSource.on(type, handlePromptReady);
}

function wireDeps() {
  // Production wiring for the modules that use __setDepsForTest as their
  // injection seam (see comments in settings.js, injector.js, panel.js).
  setSettingsDeps({
    extension_settings,
    saveSettingsDebounced,
    warn: (...args) => console.warn(...args),
  });

  setInjectorDeps({
    getSettings: () => extension_settings.rabbitResponseTeam ?? null,
    getContext: () => SillyTavern.getContext(),
    words: { getWordBank, sampleWords, getWordMeta },
    synonyms: { getSynonyms, getAssociations, hasEntry },
    warn: (...args) => console.warn(...args),
  });

  setPanelDeps({
    $: typeof jQuery !== 'undefined' ? jQuery : null,
    toastr: SillyTavern.getContext()?.toastr ?? null,
    generateWords: async (lang, settings, userMessage) => {
      // The Test button bypasses the injector; pull data in lazily so the
      // sample reflects the user's actual word bank.
      await ensureAssetsForLanguage(lang);
      return generateWords(lang, settings, userMessage);
    },
    getContext: () => SillyTavern.getContext(),
    warn: (...args) => console.warn(...args),
  });
}

function init() {
  try {
    wireDeps();
    loadSettings();

    const container =
      typeof document !== 'undefined'
        ? document.getElementById('extensions_settings')
        : null;
    if (container) {
      renderSettings(container);
      // bindEvents is async but we don't need to await it to start handling
      // chat turns — listener registration happens below in parallel.
      bindEvents(container).catch((err) =>
        console.warn('Rabbit Response Team: panel bind failed:', err),
      );
    }

    registerEventListener();
    console.log('🐰 Rabbit Response Team: extension initialized');
  } catch (err) {
    console.error('Rabbit Response Team: init failed:', err);
  }
}

if (typeof jQuery !== 'undefined') {
  jQuery(async () => init());
} else if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => init());
} else {
  // Non-browser (e.g. unit-test import). No-op; tests wire deps themselves.
}
