# Changelog

## [Unreleased]

### Fixed
- Starting a pen stroke on another page within two seconds of drawing on the previous one no longer throws `NotFoundError` from `setPointerCapture`. The ink tool waited for the previous page's strokes to save before capturing the pointer, and a quick Apple Pencil stroke had lifted by then, so the capture failed and the new stroke started in a broken state. The save is now handed off without waiting.
- Leaving the draw tool no longer throws `TypeError: null is not an object (evaluating 'this.element.querySelector')` when the viewer is torn down while the last strokes are saving. The tool restored the previous colour only after the save returned, by which point the colour picker could be gone; it now restores it straight away, which also stops a slow save from overwriting the colour the next tool chose. `ColorPicker#setColor` is a no-op after `destroy()`.

## [0.7.0] - 2026-11-07

### Fixed
- Hyperlinks inside a PDF are now clickable in the viewer. A link written by PowerPoint, Keynote, Word or InDesign (a YouTube URL on a slide, a table of contents, a "see page 12" reference) was drawn on the canvas but never made interactive, because the viewer read nothing from the PDF's own `/Annots`. The file itself was never altered; links worked in a downloaded copy. Present since 0.1.0.
  - Web (`http`, `https`) and `mailto` links open in a new tab with `rel="noopener noreferrer"`. Other schemes, JavaScript, launch and embedded-file actions are not followed.
  - Links to another page (explicit and named destinations, plus the `NextPage` / `PrevPage` / `FirstPage` / `LastPage` named actions) scroll the viewer to that page.
  - Links sit above the text layer and below the viewer's own annotations, so highlights and notes keep priority on clicks. They stand aside while an annotation tool is active or text is being selected, so linked text can still be highlighted.
  - As in Acrobat and Preview, nothing marks a link beyond the pointer cursor and what the PDF itself draws. A border the PDF specifies (`/Border` or `/BS`, in the `/C` colour) is drawn and scales with zoom, so LaTeX `hyperref`'s boxed links keep their boxes. A link with no border entry stays borderless, as PDF.js treats it. Beveled and inset borders are approximated with CSS `outset` and `inset`. Keyboard focus shows a white ring inside a blue one, visible on light and dark slides.

### Added
- Open the viewer at a named destination, or jump to one later. Named destinations are anchors stored in the PDF (Word, InDesign and LaTeX write them for headings and bookmarks), and they make better deep links than page numbers because they survive the document being regenerated. The new `initialDestination` controller value opens the document there, falling back to `initialPage` when the document has no such name. `PdfViewer#goToDestination(name)` and `CoreViewer#goToDestination(name)` scroll to one and resolve to `false` if it isn't defined. `CoreViewer#resolveDestination(dest)` exposes the lookup itself, returning the page and point without scrolling.
- Links to a spot within a page now scroll to that spot, not just to the top of the page. `XYZ`, `FitH`, `FitBH`, `FitV`, `FitBV` and `FitR` destinations bring the point they name to the top-left of the view, through the page's viewport, so `/Rotate` and crop box offsets are respected. Any zoom the destination carries is ignored, so following a link never changes the reader's zoom. `CoreViewer#goToPage` and `PdfViewer#goToPage` accept `{ point: { x, y } }` in PDF user space.
- `pdf-viewer:link-clicked` is dispatched on the container before a link in the PDF is followed, with `{ kind: "external", url }` or `{ kind: "internal", pageNumber }`. It is cancelable, so a host that opens links itself (a native app's web view, where `target="_blank"` may do nothing) can call `preventDefault()` and take over. `LinkLayer` takes the equivalent `onLinkClick` callback.
- `LinkLayer` (`src/lib/ui/link_layer.js`), which builds a `.link-layer` of `a.pdf-link` elements per page. Links are positioned in percentages of the page, so they follow zoom without being re-placed. Hosts can restyle `.pdf-link`; links with a PDF-specified border also carry `.pdf-link--bordered`.
- `ViewerEvents.ANNOTATION_LAYER_RENDERED` is now dispatched on the internal `EventBus` after each page's links are placed, with `{ pageNumber, layer, linkCount }`. `layer` is `null` for a page with no links. The event was declared previously but never fired.
- `ViewerEvents.PAGE_RENDERED` now also carries the PDF.js `page` and the `viewport` the page was drawn at.

## [0.6.0] - 2026-09-22

### Fixed
- Underline annotations are now included in annotated downloads. `DownloadManager` dispatched on an `annotation_type` of `underline` while `UnderlineTool` created annotations as `line`, so `_applyUnderline` was never reached and underlines were silently omitted from the exported PDF. They rendered on screen, so the omission only showed up in the downloaded file. Present since 0.1.0.
- Comments on highlights, underlines, and drawings are now included in annotated downloads, as the annotation's `Contents`. Only notes wrote `Contents`, so any other annotation's comment was dropped from the exported PDF.
- Note bodies and comments containing characters outside PDFDocEncoding (curly quotes, em dashes, `✓`, most non-Latin scripts) no longer come out garbled or truncated in annotated downloads. `Contents` is now written with `PDFHexString.fromText`, which falls back to UTF-16BE, instead of `PDFString.of`.
- Search now selects the first match on a document's very first search. Because the first search runs before any text has been extracted, matches arrived from the background extraction with no current match set, leaving the find bar at "0 of N" with nothing highlighted until the user pressed Next. Later searches were unaffected, since the text was already cached.
- A document whose name consists entirely of characters that are illegal in filenames (e.g. `///`) now downloads as `document.pdf` rather than as a hidden `.pdf` file. The fallback was unreachable because the extension was appended before the empty check.
- `PdfViewer` no longer throws a `TypeError` when the host's markup is missing `.pdf-pages-container`. It logged an actionable error and bailed out of component initialization, then crashed in event listener setup, burying that message.

### Changed
- **The canonical `annotation_type` for underlines is now `underline`, not `line`.** Records are normalized as they enter `AnnotationManager`, so stored `line` values continue to work and no migration is required to upgrade. New annotations are written as `underline`.
- Annotation vocabulary is centralized in `src/lib/annotation_types.js`, which exports `AnnotationType`, `PDF_SUBTYPES` (the PDF spec subtype each type exports as), and the `isHighlightLike` / `isDrawing` / `isFreeHighlight` / `supportsComment` predicates. `AnnotationType`, `PDF_SUBTYPES`, and `normalizeAnnotationType` are re-exported from the package entry points.

### Internal
- Added a test suite: Vitest with jsdom, 815 tests covering the annotation vocabulary, stores, annotation and download managers, coordinate transforms, search, tools, UI components, Stimulus controllers, and `PdfViewer`/`CoreViewer`. `npm test` runs it; `npm run test:coverage` reports coverage. `DownloadManager` is tested against real PDFs built and re-parsed with pdf-lib rather than against mocks.

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
