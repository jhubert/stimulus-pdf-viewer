# stimulus-pdf-viewer

A full-featured PDF viewer with annotation support, built for [Stimulus](https://stimulus.hotwired.dev/) and the [Hotwire](https://hotwired.dev/) ecosystem.

**[Try the live demo](https://jhubert.github.io/stimulus-pdf-viewer/)**

<img width="1133" height="831" alt="stimulus-pdf-viewer screenshot" src="https://raw.githubusercontent.com/jhubert/stimulus-pdf-viewer/main/screenshot.png" />

## Features

- **PDF Rendering** - Powered by Mozilla's PDF.js with lazy page loading
- **Annotations** - Highlights, underlines, sticky notes, and freehand drawing
- **Search** - Find text within the document with keyboard shortcuts
- **Thumbnails** - Page thumbnail sidebar for quick navigation
- **Zoom Controls** - Fit to page, fit to width, or custom zoom levels
- **Watermarks** - User-specific watermarks for document security
- **Download** - Export PDFs with annotations embedded
- **Mobile Support** - Touch gestures, responsive toolbar, pinch-to-zoom
- **Accessibility** - Screen reader support, keyboard navigation, high contrast mode

## Installation

```bash
npm install stimulus-pdf-viewer @hotwired/stimulus @rails/request.js pdfjs-dist pdf-lib
```

Or with yarn:

```bash
yarn add stimulus-pdf-viewer @hotwired/stimulus @rails/request.js pdfjs-dist pdf-lib
```

### Using Importmap (Rails 7+)

**Option 1: Download vendored files (Recommended)**

Download the packages to your vendor directory:

```bash
bin/importmap pin stimulus-pdf-viewer pdfjs-dist pdf-lib --download
```

Then download the PDF.js worker file separately:

```bash
curl -o vendor/javascript/pdfjs-dist--pdf.worker.js \
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.worker.mjs"
```

Add the worker to your `config/importmap.rb`:

```ruby
pin "pdfjs-dist/build/pdf.worker.mjs", to: "pdfjs-dist--pdf.worker.js"
```

**Option 2: Use CDN URLs**

Add the following to your `config/importmap.rb`:

```ruby
pin "stimulus-pdf-viewer", to: "https://ga.jspm.io/npm:stimulus-pdf-viewer@1.0.0/dist/stimulus-pdf-viewer.esm.js"
pin "pdfjs-dist", to: "https://ga.jspm.io/npm:pdfjs-dist@4.9.155/build/pdf.mjs"
pin "pdfjs-dist/build/pdf.worker.mjs", to: "https://ga.jspm.io/npm:pdfjs-dist@4.9.155/build/pdf.worker.mjs"
pin "pdf-lib", to: "https://ga.jspm.io/npm:pdf-lib@1.17.1/dist/pdf-lib.esm.js"
```

## Quick Start

### 1. Register the controllers

```javascript
import { Application } from "@hotwired/stimulus"
import { PdfViewerController, PdfDownloadController } from "stimulus-pdf-viewer"

const application = Application.start()
application.register("pdf-viewer", PdfViewerController)
application.register("pdf-download", PdfDownloadController)
```

### 2. Add the styles

```scss
// In your application.scss
@import "stimulus-pdf-viewer/styles/pdf-viewer";
```

Or copy `styles/pdf-viewer.scss` to your stylesheets directory.

### 3. Copy cursor assets

Copy the cursor SVG files from `assets/cursors/` to your asset pipeline (e.g., `app/assets/images/pdf_viewer/`).

### 4. Set up the PDF.js worker

Add a meta tag to configure the PDF.js worker path:

```html
<meta name="pdf-worker-src" content="<%= asset_path('pdfjs-dist--pdf.worker.js') %>">
```

### 5. Create the viewer HTML

```erb
<div data-controller="pdf-viewer"
     data-pdf-viewer-document-url-value="<%= url_for(@document.file) %>"
     data-pdf-viewer-document-name-value="<%= @document.name %>"
     data-pdf-viewer-annotations-url-value="<%= document_annotations_path(@document) %>"
     data-pdf-viewer-user-name-value="<%= current_user.name %>"
     class="pdf-viewer-container">

  <!-- Toolbar -->
  <div class="pdf-toolbar">
    <!-- See examples/rails/_toolbar.html.erb for full toolbar markup -->
  </div>

  <!-- Viewer body -->
  <div class="pdf-viewer-body">
    <div class="pdf-pages-container" data-pdf-viewer-target="container"></div>
  </div>

  <!-- Loading overlay -->
  <div class="pdf-loading-overlay" data-pdf-viewer-target="loadingOverlay">
    <div class="pdf-loading-spinner"></div>
    <div class="pdf-loading-text">Loading document...</div>
  </div>
</div>
```

## Configuration

The `PdfViewerController` accepts the following Stimulus values:

| Value | Type | Description |
|-------|------|-------------|
| `documentUrl` | String | URL to the PDF file |
| `documentName` | String | Display name for downloads |
| `annotationsUrl` | String | REST API endpoint for annotations |
| `trackingUrl` | String | (Optional) Endpoint for time tracking |
| `userName` | String | User name for watermarks |
| `organizationName` | String | Organization name for watermarks |
| `initialPage` | Number | Page to open on load (default: 1) |
| `initialAnnotation` | String | Annotation ID to highlight on load |

## Annotations API

The viewer expects a REST API at `annotationsUrl` with these endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `{annotationsUrl}.json` | List all annotations |
| POST | `{annotationsUrl}` | Create annotation |
| PATCH | `{annotationsUrl}/{id}` | Update annotation |
| DELETE | `{annotationsUrl}/{id}` | Delete annotation |
| PATCH | `{annotationsUrl}/{id}/restore` | Restore deleted annotation |

### Annotation JSON Schema

```json
{
  "id": "uuid",
  "page": 1,
  "annotation_type": "highlight|underline|note|ink",
  "color": "#FFEB3B",
  "opacity": 0.4,
  "quads": [{"p1": {"x": 100, "y": 200}, "p2": {...}, "p3": {...}, "p4": {...}}],
  "rect": [100, 200, 124, 224],
  "contents": "Note text content",
  "ink_strokes": [{"points": [{"x": 100, "y": 200}]}],
  "thickness": 2
}
```

## Events

The viewer dispatches these custom events on the container element:

| Event | Description |
|-------|-------------|
| `pdf-viewer:ready` | Document loaded and ready |
| `pdf-viewer:page-changed` | User navigated to a different page |
| `pdf-viewer:annotation-created` | New annotation created |
| `pdf-viewer:annotation-updated` | Annotation modified |
| `pdf-viewer:annotation-deleted` | Annotation deleted |
| `pdf-viewer:annotation-selected` | User selected an annotation |
| `pdf-viewer:scale-changed` | Zoom level changed |
| `pdf-viewer:error` | Error occurred |

## Error Handling

Pass an `onError` callback when using the `PdfViewer` class directly:

```javascript
const viewer = new PdfViewer(container, {
  documentUrl: "/path/to/document.pdf",
  onError: (error) => {
    // Send to your error tracking service
    Sentry.captureException(error)
  }
})
```

## Rails Integration

For the easiest Rails setup, use the [stimulus-pdf-viewer-rails](https://github.com/jhubert/stimulus-pdf-viewer-rails) gem which handles asset configuration automatically.

For manual integration, see `examples/rails/` for complete Rails integration examples including:

- View partials for the viewer and toolbar
- Annotations controller
- Annotation model with validations

## Browser Support

- Chrome/Edge 88+
- Firefox 78+
- Safari 14+
- Mobile Safari (iOS 14+)
- Chrome for Android

## License

This project is dual-licensed:

- **MIT License** ([LICENSE-MIT](LICENSE-MIT)) - for original code
- **Apache License 2.0** ([LICENSE-APACHE](LICENSE-APACHE)) - for code derived from PDF.js

See the [NOTICE](NOTICE) file for attribution details.

## Credits

Built with:
- [PDF.js](https://mozilla.github.io/pdf.js/) - PDF rendering engine (Apache 2.0). Portions of this library's rendering queue, text layer selection, and search functionality are derived from PDF.js patterns.
- [pdf-lib](https://pdf-lib.js.org/) - PDF manipulation for downloads
- [Stimulus](https://stimulus.hotwired.dev/) - JavaScript framework
- [@rails/request.js](https://github.com/rails/request.js) - HTTP requests with Turbo Stream support
