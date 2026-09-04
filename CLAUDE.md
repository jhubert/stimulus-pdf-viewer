# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

stimulus-pdf-viewer is a standalone PDF viewer with annotation support, built for the Stimulus/Hotwire ecosystem. It was extracted from Boardwise to be reusable across Rails, Django, Laravel, and any project using Stimulus.

## Build Commands

```bash
npm install           # Install dependencies
npm run build         # Build with Rollup (outputs to dist/)
npm run dev           # Watch mode for development
npm test              # Run the test suite once
npm run test:watch    # Re-run tests on change
npm run test:coverage # Test suite with a coverage report
```

## Architecture Overview

### Layered Architecture

- `src/controllers/` - Stimulus controllers that wire up the UI (know about DOM, data-* attributes)
- `src/lib/` - Framework-agnostic library code (no Stimulus dependencies)
- `src/lib/core/` - Lowest level, PDF.js wrapping and rendering

**Stimulus Controllers**:
- `PdfViewerController` - Main controller integrating viewer with DOM, toolbar actions, keyboard shortcuts
- `PdfDownloadController` - Standalone download button controller

**Library Core**:
- `PdfViewer` class (`src/lib/index.js`) - High-level orchestrator managing tools, annotations, UI components
- `CoreViewer` class (`src/lib/core/viewer.js`) - Low-level PDF.js wrapper for rendering, zoom, navigation
- `RenderingQueue` - Lazy page rendering prioritized by visibility
- `EventBus` - Internal pub/sub for component communication

**Annotation System**:
- `AnnotationManager` - CRUD operations via REST API
- Tools in `src/lib/tools/` all extend `BaseTool` with `activate()`, `deactivate()`, and event handlers
- Only one tool active at a time, managed by `PdfViewer`
- `annotation_types.js` - canonical `annotation_type` vocabulary, legacy aliases, and the PDF subtype each type exports as

### Annotation Vocabulary

`annotation_type` is a wire field: it crosses the REST API and lives in the consuming
application's database, so this library does not control every value it may receive.

- Canonical values are `highlight`, `underline`, `note`, `ink` (`AnnotationType`)
- Inbound records are normalized once, in `AnnotationManager`. Legacy values are
  listed in `LEGACY_TYPE_ALIASES`; `line` is accepted and rewritten to `underline`
- Everything downstream of the manager may assume canonical values. Compare against
  `AnnotationType` constants, never string literals
- Freehand highlights are `ink` records discriminated by `subject === "Free Highlight"`,
  since both pen and highlighter export as PDF Ink annotations. Use the
  `isHighlightLike` / `isDrawing` / `isFreeHighlight` helpers rather than re-testing
  the type and subject inline

Note that internal type names are not PDF spec subtype names. `PDF_SUBTYPES` maps
between them: a `note` exports as PDF subtype `Text`, not `Note`.

**UI Components** (`src/lib/ui/`):
- Sidebars, find bar, color picker, annotation toolbars
- Toolbar HTML lives in the consuming application (see `examples/rails/_toolbar.html.erb`)

### Coordinate System

- **PDF coordinates**: origin at bottom-left, units in points (1/72 inch)
- **Screen coordinates**: origin at top-left, units in pixels
- `CoordinateTransformer` handles conversions
- Annotations store PDF coordinates; UI renders in screen coordinates
- Percentage-based positioning for annotations so they scale automatically with zoom

### Event System

- Internal events use `EventBus` for component communication
- External events dispatch `CustomEvent` on the container element
- Event names follow pattern: `pdf-viewer:{action}` (e.g., `pdf-viewer:annotation-created`)

### Dependencies

Peer dependencies that consumers must install:
- `@hotwired/stimulus` ^3.0.0
- `@rails/request.js` ^0.0.9
- `pdfjs-dist` ^4.0.0
- `pdf-lib` ^1.17.0

PDF.js worker must be configured via a `<meta name="pdf-worker-src">` tag.

## Code Conventions

- Files: `snake_case.js`
- Classes: `PascalCase`
- Methods/variables: `camelCase`
- Private methods: `_prefixedWithUnderscore`
- Constants: `UPPER_SNAKE_CASE`
- Events: `kebab-case` (e.g., `pdf-viewer:page-changed`)

## Common Tasks

**Adding a new annotation type:**
1. Add the canonical type to `AnnotationType` in `lib/annotation_types.js`, and its PDF
   subtype to `PDF_SUBTYPES`
2. Create tool in `lib/tools/` extending `BaseTool`, emitting the `AnnotationType` constant
3. Add to `ToolMode` enum in `lib/index.js`
4. Register in `PdfViewer._initializeComponents()` tools object
5. Add UI rendering in `PdfViewer._createAnnotationElement()`
6. Add a `case` to `DownloadManager._applyAnnotationsToPage()` and a writer for it,
   or the annotation renders on screen but is silently dropped from annotated downloads
7. Add the type to the sidebar filter and display in `lib/ui/annotation_sidebar.js`
8. Add toolbar button in consuming app's view

**Testing:**

Vitest with jsdom. Tests live in `test/`, mirroring `src/`: `test/unit/` per module,
`test/integration/` for `PdfViewer` wired to its components.

- `test/helpers/factories.js` builds annotation records; prefer it over inline
  literals so a shape change is fixed in one place. Note the real field shapes:
  quads are `{p1..p4}` objects, ink is `ink_strokes: [{points: [{x, y}]}]`
- `test/helpers/dom.js` stubs element geometry, since jsdom has no layout engine
  and reports every rect as zero-sized
- `test/helpers/pdf.js` builds real PDFs with pdf-lib and reads their annotation
  dictionaries back, so `DownloadManager` is tested against actual PDF output
- `test/helpers/viewer_fixture.js` provides a `CoreViewer` stand-in sharing a real
  `EventBus`, so `PdfViewer`'s subscriptions are exercised rather than stubbed
- pdf-lib, Stimulus, and pdfjs-dist are installed, so prefer the real library over
  a mock where it runs in node. `PDFDocument.load()` rewrites Producer unless
  passed `{ updateMetadata: false }` — pass it when asserting on document metadata

**Adding a new UI component:**
1. Create class in `lib/ui/`
2. Initialize in `PdfViewer._initializeComponents()`
3. Clean up in `PdfViewer.destroy()`
