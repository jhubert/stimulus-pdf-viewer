# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

stimulus-pdf-viewer is a standalone PDF viewer with annotation support, built for the Stimulus/Hotwire ecosystem. It was extracted from Boardwise to be reusable across Rails, Django, Laravel, and any project using Stimulus.

## Build Commands

```bash
npm install      # Install dependencies
npm run build    # Build with Rollup (outputs to dist/)
npm run dev      # Watch mode for development
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
1. Create tool in `lib/tools/` extending `BaseTool`
2. Add to `ToolMode` enum in `lib/index.js`
3. Register in `PdfViewer._initializeComponents()` tools object
4. Add UI rendering in `PdfViewer._createAnnotationElement()`
5. Add toolbar button in consuming app's view

**Adding a new UI component:**
1. Create class in `lib/ui/`
2. Initialize in `PdfViewer._initializeComponents()`
3. Clean up in `PdfViewer.destroy()`
