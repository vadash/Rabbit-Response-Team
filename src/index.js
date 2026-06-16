// SillyTavern extension entry point.
// Per design §4 (file structure), §8 (src/index.js interface), §9.1 (init
// sequence), §9.3 (failure modes). Wires ST globals into the settings,
// data, engine, and ui layers and registers the GENERATION_AFTER_COMMANDS
// listener that drives setExtensionPrompt for the two slots. Asset loading
// stays lazy per §9.2 — nothing is fetched at boot.
//
// Root index.js re-exports this module so manifest.json's `js: "index.js"`
// keeps pointing at the file ST has always loaded.

import {
  saveSettingsDebounced,
  setExtensionPrompt,
  extension_prompt_types,
  extension_prompt_roles,
} from '../../../../../script.js';
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
  buildInjections,
  mapRole,
  __setDepsForTest as setInjectorDeps,
} from './engine/injector.js';
import {
  renderSettings,
  bindEvents,
  __setDepsForTest as setPanelDeps,
} from './ui/panel.js';

const EXTENSION_NAME = 'rabbit-response-team';

const SLOT_RANDOM = 'rabbitResponseTeam_random';
const SLOT_SYNONYM = 'rabbitResponseTeam_synonym';

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

// Apply a rendered slot via setExtensionPrompt. IN_CHAT (1) places the
// prompt into the in-chat depth-controlled slot, matching the pre-refactor
// injectionDepth behavior.
function writeSlot(key, injection) {
  setExtensionPrompt(
    key,
    injection.content,
    extension_prompt_types.IN_CHAT,
    injection.depth,
    false,
    injection.role,
  );
}

// Clear a slot by writing an empty value at depth 0 / SYSTEM role. Keeps
// stale content from prior turns out of the prompt when a feature is
// disabled or produced nothing this turn.
function clearSlot(key) {
  setExtensionPrompt(
    key,
    '',
    extension_prompt_types.IN_CHAT,
    0,
    false,
    extension_prompt_roles.SYSTEM,
  );
}

// GENERATION_AFTER_COMMANDS listener. Builds the two slot descriptors via
// the pure-compute injector and applies (or clears) them via
// setExtensionPrompt. Diagnostic logs at every decision point so silent
// failures become traceable in the browser console.
async function handleGeneration(type, options, dryRun) {
  const startedAt =
    typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  console.log(`🐰 RRT: handleGeneration entry type=${type} dryRun=${dryRun}`);
  try {
    const settings = loadSettings();
    const rwEnabled = !!settings?.randomWords?.enabled;
    const synEnabled = !!settings?.synonyms?.enabled;
    console.log(
      `🐰 RRT: enabled random=${rwEnabled} synonyms=${synEnabled}`,
    );

    if (!rwEnabled && !synEnabled) {
      clearSlot(SLOT_RANDOM);
      clearSlot(SLOT_SYNONYM);
      console.log(
        `🐰 RRT: slot=random action=clear reason=disabled`,
      );
      console.log(
        `🐰 RRT: slot=synonym action=clear reason=disabled`,
      );
      return;
    }

    const { chat: ctxChat } = SillyTavern.getContext?.() ?? {};
    const lastUser =
      Array.isArray(ctxChat) && ctxChat.length
        ? (ctxChat
            .slice()
            .reverse()
            .find((m) => m?.is_user)?.mes ?? '')
        : '';
    const resolved = resolveLanguage(
      settings.language || 'auto',
      lastUser,
    );
    console.log(
      `🐰 RRT: resolved lang=${resolved} (lastUser ${lastUser.length} chars)`,
    );

    try {
      await ensureAssetsForLanguage(resolved);
      console.log('🐰 RRT: assets loaded');
    } catch {
      // ensureAssetsForLanguage already announced via toastr. Clear slots
      // and bail — the injector must not run against missing data.
      clearSlot(SLOT_RANDOM);
      clearSlot(SLOT_SYNONYM);
      console.log(
        `🐰 RRT: slot=random action=clear reason=asset-failure`,
      );
      console.log(
        `🐰 RRT: slot=synonym action=clear reason=asset-failure`,
      );
      return;
    }

    // Synonym scanner is assistant-only: exclude user messages so the
    // frequency map reflects the model's own diction, not the user's.
    const chatTexts = (ctxChat ?? [])
      .filter((m) => m && m.is_user === false)
      .map((m) => m?.mes ?? m?.content ?? '');
    const result = await buildInjections(
      settings,
      resolved,
      lastUser,
      chatTexts,
    );

    if (result.random) {
      writeSlot(SLOT_RANDOM, result.random);
      console.log(
        `🐰 RRT: slot=random action=set contentLen=${result.random.content.length} depth=${result.random.depth} role=${result.random.role}`,
      );
    } else {
      clearSlot(SLOT_RANDOM);
      console.log(`🐰 RRT: slot=random action=clear`);
    }

    if (result.synonyms) {
      writeSlot(SLOT_SYNONYM, result.synonyms);
      console.log(
        `🐰 RRT: slot=synonym action=set contentLen=${result.synonyms.content.length} depth=${result.synonyms.depth} role=${result.synonyms.role}`,
      );
    } else {
      clearSlot(SLOT_SYNONYM);
      console.log(`🐰 RRT: slot=synonym action=clear`);
    }
  } catch (err) {
    console.warn('🐰 RRT: handleGeneration failed:', err);
  } finally {
    const endedAt =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
    console.log(
      `🐰 RRT: handleGeneration exit duration=${Math.round(endedAt - startedAt)}ms`,
    );
  }
}

function registerEventListener() {
  const { eventSource, event_types } = SillyTavern.getContext();
  if (!eventSource || !event_types) {
    console.warn('Rabbit Response Team: SillyTavern event bus unavailable.');
    return;
  }
  const type = event_types.GENERATION_AFTER_COMMANDS;
  if (!type) {
    console.warn(
      'Rabbit Response Team: GENERATION_AFTER_COMMANDS not found in event_types.',
    );
    return;
  }
  eventSource.makeFirst(type, handleGeneration);
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
