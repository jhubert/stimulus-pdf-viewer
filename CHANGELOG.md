# Changelog

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
