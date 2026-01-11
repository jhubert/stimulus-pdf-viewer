// stimulus-pdf-viewer
// PDF viewer with annotation support for Stimulus and Hotwire

// Main Stimulus controllers
export { default as PdfViewerController } from "./controllers/pdf_viewer_controller"
export { default as PdfDownloadController } from "./controllers/pdf_download_controller"
export { default as PdfSyncScrollController } from "./controllers/pdf_sync_scroll_controller"

// Core library exports
export { PdfViewer, ToolMode, CoreViewer, ViewerEvents } from "./lib"

// Annotation stores for custom persistence
export {
  AnnotationStore,
  RestAnnotationStore,
  MemoryAnnotationStore
} from "./lib/stores"
