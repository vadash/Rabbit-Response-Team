## Plan: Minimized-by-default UI with Basic/Advanced sections

### Current state
- The main header starts **expanded** (`aria-expanded="true"`, body visible)
- Each tab (Random Words, Synonyms) has a single "Advanced Settings" collapsible section, but everything else is flat
- The user wants: (1) main panel minimized by default, (2) two sections inside (Basic + Advanced), both minimized by default

### Changes

#### 1. `src/ui/templates.js` — `panelShell`
- Change main header `aria-expanded` from `"true"` to `"false"`
- Add `style="display: none;"` to `#rabbit-settings-body` so it starts collapsed

#### 2. `src/ui/templates.js` — restructure each tab into Basic/Advanced
- **Random Words tab**: Wrap existing non-advanced controls (enable toggle, word count, mode, word length, parts of speech, theme words, test button) in a "Basic" collapsible section header + body. Keep the existing "Advanced Settings" collapsible as-is.
- **Synonyms tab**: Same pattern — wrap non-advanced controls (enable toggle, scan depth, min occurrences, top N, output mode, test button) in a "Basic" collapsible section. Keep existing "Advanced Settings" collapsible as-is.
- Both "Basic" and "Advanced" sections start minimized by default (`aria-expanded="false"`, body `display: none`)

#### 3. `src/ui/panel.js` — add toggle handler for Basic sections
- Add a click handler for `.rabbit-basic-header` that toggles its target body (same pattern as `.rabbit-advanced-header`)

#### 4. `styles.css` — add `.rabbit-basic-header` styles
- Reuse the existing `.rabbit-advanced-header` styling for `.rabbit-basic-header` (or combine the selectors)

### Structure after change
```
🐰 Rabbit Response Team  (minimized by default)
├── [expand] Settings body
│   ├── Language Mode
│   ├── Tabs: Random Words | Synonyms
│   ├── Random Words tab
│   │   ├── ▸ Basic Settings (minimized)
│   │   │   ├── Enable toggle, word count, mode, word length, POS, theme words, test button
│   │   └── ▸ Advanced Settings (minimized, existing)
│   │       ├── Custom prompt, injection depth/role, blacklist, history size, reset button
│   └── Synonyms tab
│       ├── ▸ Basic Settings (minimized)
│       │   ├── Enable toggle, scan depth, min occurrences, top N, output mode, test button
│       └── ▸ Advanced Settings (minimized, existing)
│           ├── Custom prompt/row, injection depth/role, reset buttons
```

All existing DOM IDs and event bindings remain unchanged — only structural wrappers are added around existing elements.