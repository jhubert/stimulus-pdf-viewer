import { Icons } from "./icons"

// Time before the undo bar automatically hides (ms)
const AUTO_HIDE_DELAY = 5000

export class UndoBar {
  constructor(container, options = {}) {
    this.container = container
    this.onUndo = options.onUndo

    this.currentAnnotation = null
    this.hideTimeout = null

    this._createBar()
    this._setupEventListeners()

    // Start hidden
    this.container.classList.add("hidden")
  }

  _createBar() {
    this.container.innerHTML = `
      <span class="pdf-undo-bar-message"></span>
      <button class="pdf-undo-bar-btn">Undo</button>
      <button class="pdf-undo-bar-dismiss" aria-label="Dismiss">
        ${Icons.close}
      </button>
    `

    this.messageElement = this.container.querySelector(".pdf-undo-bar-message")
    this.undoButton = this.container.querySelector(".pdf-undo-bar-btn")
    this.dismissButton = this.container.querySelector(".pdf-undo-bar-dismiss")
  }

  _setupEventListeners() {
    this.undoButton.addEventListener("click", () => {
      if (this.currentAnnotation && this.onUndo) {
        this.onUndo(this.currentAnnotation)
      }
      this.hide()
    })

    this.dismissButton.addEventListener("click", () => {
      this.hide()
    })
  }

  show(annotation) {
    // Clear any existing timeout
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout)
    }

    this.currentAnnotation = annotation

    // Set message based on annotation type
    const typeMessages = {
      highlight: "Highlight deleted",
      underline: "Underline deleted",
      note: "Note deleted",
      ink: "Drawing deleted"
    }
    this.messageElement.textContent = typeMessages[annotation.annotation_type] || "Annotation deleted"

    // Show the bar (hidden class is on the container)
    this.container.classList.remove("hidden")

    // Auto-hide after delay
    this.hideTimeout = setTimeout(() => {
      this.hide()
    }, AUTO_HIDE_DELAY)
  }

  hide() {
    this.container.classList.add("hidden")
    this.currentAnnotation = null

    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout)
      this.hideTimeout = null
    }
  }

  destroy() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout)
    }
  }
}
