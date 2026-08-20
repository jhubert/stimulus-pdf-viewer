# Changelog

## [Unreleased]

### Fixed
- Underline annotations are now included in annotated downloads. `DownloadManager` dispatched on an `annotation_type` of `underline` while `UnderlineTool` created annotations as `line`, so `_applyUnderline` was never reached and underlines were silently omitted from the exported PDF. They rendered on screen, so the omission only showed up in the downloaded file. Present since 0.1.0.

### Changed
- **The canonical `annotation_type` for underlines is now `underline`, not `line`.** Records are normalized as they enter `AnnotationManager`, so stored `line` values continue to work and no migration is required to upgrade. New annotations are written as `underline`.
- Annotation vocabulary is centralized in `src/lib/annotation_types.js`, which exports `AnnotationType`, `PDF_SUBTYPES` (the PDF spec subtype each type exports as), and the `isHighlightLike` / `isDrawing` / `isFreeHighlight` / `supportsComment` predicates. `AnnotationType`, `PDF_SUBTYPES`, and `normalizeAnnotationType` are re-exported from the package entry points.

### Deprecated
- `annotation_type: "line"`. Still accepted on read and mapped to `underline`, but reading one now logs a one-time console warning naming the migration to run: `UPDATE annotations SET annotation_type = 'underline' WHERE annotation_type = 'line';`. Support will be removed in a future release. Because `annotation_type` is stored in the consuming application's database, a version bump does not migrate existing rows — run the migration before upgrading past the release that drops the alias, since unmigrated records will neither render nor appear in downloads. Absence of the warning during normal use is a good signal that no legacy rows remain.

## [0.5.0] - 2026-08-11

### Added
- Password-protected PDF support: the viewer now prompts for the password (with retry on incorrect entry) instead of failing to load. Encrypted documents open in read-only mode — annotation tools are disabled and the download button delivers the original file, since pdf-lib cannot open encrypted PDFs to embed annotations. Read-only mode is exposed via `detail.readOnly` on `pdf-viewer:ready`, a `pdf-viewer-read-only` container class, and `PdfViewer#readOnly`. A password entered during the streamed load is reused by the full-fetch fallback so users aren't prompted twice.

## [0.4.1] - 2026-08-10

### Fixed
- `initialAnnotation` deep-links never scrolled to or selected the annotation: annotation ids arrive as numbers from the JSON payload but as strings from the `initial-annotation` Stimulus value, and the strictly-typed `Map` lookup missed. `AnnotationManager` and the sidebar now normalize ids to strings, so deep-links, sidebar selection, and delete/update lookups work regardless of id type.

### Changed
- `initialAnnotation` deep-links now use the same flash/highlight treatment as sidebar clicks, so visitors arriving from a shared link can spot the annotation immediately.

## [0.4.0] - 2026-06-24

### Added
- Page rotation support: pages with a `/Rotate` value (e.g. landscape scans stored as portrait + `/Rotate 90`) now render in their intended orientation instead of sideways. The text layer and highlight/underline overlays rotate with the page so selection and annotations stay aligned.
- `ScaleValue` is now exported from the package entry points, so consumers can pass the `page-fit` / `page-width` / `auto` presets to `setScale()` by constant.

### Fixed
- Mixed-size/orientation documents: page placeholders are now sized per page (filled in lazily as you scroll) instead of from page 1, and the fit presets (`page-fit` / `page-width` / `auto`) measure the current page. Previously every page used page 1's dimensions, causing layout jumps and mis-fitted zoom.
- Large-format pages and high zoom on retina displays no longer render as a blank page: the canvas backing store is clamped to the browser's maximum dimensions/area (degrading to slightly softer rendering instead of failing).
- "Maximum call stack size exceeded" crash when loading a new PDF, caused by infinite recursion in the internal EventBus when removing an `AbortSignal`-bound listener.
- Memory leaks across connect/disconnect (Turbo navigation) cycles: the core viewer, orchestrator, and UI components now remove all of their document/window/EventBus listeners on teardown, the core viewer releases the previous PDF document and page resources on reload, and the shared screen-reader announcer is reference-counted so overlapping viewers don't tear it down prematurely.

### Security
- Fixed stored XSS reachable from untrusted annotation data: note contents in the edit dialog and `annotation.color` values were interpolated into HTML/CSS. Note text is now set via the DOM, colors are validated against a hex allowlist, and the annotation sidebar escapes all non-icon fields.

### Internal
- Removed dead code (unused coordinate/accessor methods on `CoreViewer` and `CoordinateTransformer`).

## [0.3.2] - 2026-05-13

### Added
- Full-fetch fallback when PDF.js's range-streamed load fails. Some corporate antivirus / web-filter products block streamed reads while allowing plain GETs; the viewer now retries once with an ArrayBuffer fetch.
- `errorMessage` controller value so host apps can supply context-aware, i18n'd copy for the failure state.
- `pdf-viewer:load-failed` DOM event dispatched after the fallback also fails, for host-app error telemetry.

### Fixed
- Loading overlay was left spinning behind the error text when document load failed. The overlay is now hidden when the error message appears.
- Duplicate color pickers in the toolbar after disconnecting and reconnecting the controller (e.g. when swapping the loaded PDF). `PdfViewer.destroy()` now tears down the color picker element and its document-level click listener.

## [0.3.1] - 2026-04-03

### Added
- Anchored detail panel for viewing and editing annotation details (opt-in via `detailPanel` option)
- `pdf-viewer:detail-panel-opened` and `pdf-viewer:detail-panel-closed` events
- Documentation for detail panel feature in README

### Fixed
- Detail panel interaction and color dropdown positioning

## [0.3.0] - 2025-12-17

### Added
- DOM events for host app integration (`pdf-viewer:annotation-created`, `pdf-viewer:annotation-updated`, etc.)
- `onCopy` and `onCut` callback hooks to PdfViewer

### Fixed
- Spurious annotation deselect events after create and update
- Duplicate sidebar event dispatch

## [0.2.1] - 2025-11-14

### Changed
- Inlined SVG cursors into CSS to remove asset dependencies
- Cleaned up CSS by removing document-related CSS classes

### Removed
- Undocumented `pdf_sync_scroll_controller`

## [0.2.0] - 2025-10-30

### Added
- Comment support for highlight, underline, and drawing annotations
- Pluggable annotation store architecture
- Support for custom annotation sidebar HTML
- Development server with live reload

### Fixed
- Multi-line text selection merging for highlights

### Changed
- **BREAKING**: Removed automatic `.json` suffix from annotations URL
- Skip loading annotations when no URL is configured

## [0.1.0] - 2025-10-15

### Added
- Initial release
- PDF rendering powered by PDF.js with lazy page loading
- Annotation support: highlights, underlines, sticky notes, freehand drawing
- Text search with keyboard shortcuts
- Page thumbnail sidebar
- Zoom controls (fit to page, fit to width, custom levels)
- User-specific watermarks
- PDF download with embedded annotations
- Mobile support with touch gestures and pinch-to-zoom
- Importmap installation instructions for Rails 7+
