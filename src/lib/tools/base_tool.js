export class BaseTool {
  constructor(pdfViewer) {
    this.pdfViewer = pdfViewer
    this.viewer = pdfViewer.viewer
    this.annotationManager = pdfViewer.annotationManager
    this.isActive = false

    // Bind event handlers - use pointer events for unified mouse/touch/pen support
    this._onPointerDown = this._onPointerDown.bind(this)
    this._onPointerMove = this._onPointerMove.bind(this)
    this._onPointerUp = this._onPointerUp.bind(this)
  }

  activate() {
    this.isActive = true
    this._addEventListeners()
    this.onActivate()
  }

  deactivate() {
    this.isActive = false
    this._removeEventListeners()
    this.onDeactivate()
  }

  _addEventListeners() {
    const container = this.pdfViewer.pagesContainer
    // Pointer events unify mouse, touch, and pen/stylus input
    container.addEventListener("pointerdown", this._onPointerDown)
    container.addEventListener("pointermove", this._onPointerMove)
    container.addEventListener("pointerup", this._onPointerUp)
    container.addEventListener("pointercancel", this._onPointerUp)
  }

  _removeEventListeners() {
    const container = this.pdfViewer.pagesContainer
    container.removeEventListener("pointerdown", this._onPointerDown)
    container.removeEventListener("pointermove", this._onPointerMove)
    container.removeEventListener("pointerup", this._onPointerUp)
    container.removeEventListener("pointercancel", this._onPointerUp)
  }

  _onPointerDown(event) {
    if (!this.isActive) return
    this.onPointerDown(event)
  }

  _onPointerMove(event) {
    if (!this.isActive) return
    this.onPointerMove(event)
  }

  _onPointerUp(event) {
    if (!this.isActive) return
    this.onPointerUp(event)
  }

  // Override in subclasses - pointer events work like mouse events but also support touch/pen
  onActivate() {}
  onDeactivate() {}
  onPointerDown(event) {}
  onPointerMove(event) {}
  onPointerUp(event) {}
  onTextLayerReady(pageNumber, textLayer) {}

  destroy() {
    this.deactivate()
  }
}
