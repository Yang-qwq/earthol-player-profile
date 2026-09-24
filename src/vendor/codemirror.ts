/**
 * Entry for the locally-bundled CodeMirror build. `scripts/build-vendor.mjs`
 * bundles this module (all its transitive `@codemirror`/`@lezer` deps included)
 * into `public/vendor/codemirror.js`, so the admin panel imports it from its own
 * origin instead of unpkg. Each namespace mirrors the dynamic import order used
 * by `codeMirrorScript` in `src/views/admin.tsx`.
 */
export * as state from '@codemirror/state';
export * as view from '@codemirror/view';
export * as language from '@codemirror/language';
export * as commands from '@codemirror/commands';
export * as langCss from '@codemirror/lang-css';
export * as langJs from '@codemirror/lang-javascript';
export * as langHtml from '@codemirror/lang-html';
export * as highlight from '@lezer/highlight';
