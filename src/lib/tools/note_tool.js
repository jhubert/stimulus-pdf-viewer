import { BaseTool } from "./base_tool"
import { CoordinateTransformer } from "../coordinate_transformer"
import { ColorPicker } from "../ui/color_picker"
import { Icons } from "../ui/icons"

export class NoteTool extends BaseTool {
  constructor(pdfViewer) {
    super(pdfViewer)
    this.transformer = new CoordinateTransformer(this.viewer)
    this.noteDialog = null
    this.pendingNote = null
    this._previousFocusElement = null // For focus restoration on dialog close
  }

  onActivate() {
    this.pdfViewer.pagesContainer.classList.add("note-mode")
  }

  onDeactivate() {
    this.pdfViewer.pagesContainer.classList.remove("note-mode")
    this._closeDialog()
  }

  onPointerDown(event) {
    // Find which page we're clicking on
    const pageContainer = event.target.closest(".pdf-page")
    if (!pageContainer) return

    // Don't create note if clicking on an existing annotation or the edit toolbar
    if (event.target.closest(".annotation") || event.target.closest(".annotation-edit-toolbar")) return

    const pageNumber = parseInt(pageContainer.dataset.pageNumber, 10)
    const coords = this.transformer.screenToPdf(event, pageNumber)

    if (!coords) return

    this.pendingNote = {
      pageNumber,
      x: coords.x,
      y: coords.y
    }

    this._showNoteDialog(event.clientX, event.clientY)
  }

  _showNoteDialog(x, y) {
    // Store currently focused element for restoration on close
    this._previousFocusElement = document.activeElement

    // Remove any existing dialog (but keep pendingNote)
    this._removeDialog()

    // Create dialog
    this.noteDialog = document.createElement("div")
    this.noteDialog.className = "note-dialog"
    this.noteDialog.innerHTML = `
      <div class="note-dialog-header">
        <span>Add Note</span>
        <button class="note-dialog-close" aria-label="Close">
          ${Icons.close}
        </button>
      </div>
      <textarea class="note-dialog-input" placeholder="Enter your note..." rows="4"></textarea>
      <div class="note-dialog-actions">
        <button class="note-dialog-save">Save</button>
      </div>
    `

    document.body.appendChild(this.noteDialog)

    // Position dialog, ensuring it stays within viewport bounds
    const { left, top } = this._constrainDialogPosition(x, y)
    this.noteDialog.style.cssText = `
      position: fixed;
      left: ${left}px;
      top: ${top}px;
      z-index: 1000;
    `

    // Focus the textarea after the browser finishes processing the pointer event
    // Use preventScroll to avoid iOS Safari scrolling the page when focusing
    const textarea = this.noteDialog.querySelector(".note-dialog-input")
    requestAnimationFrame(() => textarea.focus({ preventScroll: true }))

    // Set up event listeners
    this._setupDialogListeners()
  }

  _constrainDialogPosition(x, y) {
    // Get dialog dimensions after it's in the DOM
    const rect = this.noteDialog.getBoundingClientRect()
    const dialogWidth = rect.width
    const dialogHeight = rect.height
    const margin = 10

    let left = x
    let top = y

    // Constrain horizontally
    if (left + dialogWidth > window.innerWidth - margin) {
      left = window.innerWidth - dialogWidth - margin
    }
    if (left < margin) {
      left = margin
    }

    // Constrain vertically
    if (top + dialogHeight > window.innerHeight - margin) {
      top = window.innerHeight - dialogHeight - margin
    }
    if (top < margin) {
      top = margin
    }

    return { left, top }
  }

  _setupDialogListeners() {
    const textarea = this.noteDialog.querySelector(".note-dialog-input")
    const closeBtn = this.noteDialog.querySelector(".note-dialog-close")
    const saveBtn = this.noteDialog.querySelector(".note-dialog-save")

    closeBtn.addEventListener("click", () => this._closeDialog())

    saveBtn.addEventListener("click", async () => {
      const text = textarea.value.trim()
      if (text) {
        await this._createNote(text)
      }
      this._closeDialog()
    })

    // Save on Ctrl+Enter
    textarea.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        const text = textarea.value.trim()
        if (text) {
          this._createNote(text)
        }
        this._closeDialog()
      } else if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        this._closeDialog()
      }
    })
  }

  _removeDialog() {
    if (this.noteDialog) {
      // Blur before removing to prevent scroll when focused element disappears
      document.activeElement?.blur()
      this.noteDialog.remove()
      this.noteDialog = null
    }
  }

  _closeDialog() {
    this._removeDialog()
    this.pendingNote = null
  }

  async _createNote(text) {
    if (!this.pendingNote) return

    const { pageNumber, x, y } = this.pendingNote
    const color = this.pdfViewer.getHighlightColor() || ColorPicker.DEFAULT_HIGHLIGHT_COLOR

    // Create annotation
    await this.annotationManager.createAnnotation({
      annotation_type: "note",
      page: pageNumber,
      rect: [x, y, 24, 24], // Icon size
      contents: text,
      color: color,
      subject: "Comment"
    })
  }

  // Method to edit an existing note
  editNote(annotation) {
    // Store currently focused element for restoration on close
    this._previousFocusElement = document.activeElement

    // Get the position of the note on screen
    const pageContainer = this.viewer.getPageContainer(annotation.page)
    if (!pageContainer) return

    const scale = this.viewer.getScale()
    const x = annotation.rect[0] * scale
    const y = annotation.rect[1] * scale
    const rect = pageContainer.getBoundingClientRect()

    // Store the annotation being edited
    this.editingAnnotation = annotation

    this._showEditDialog(rect.left + x, rect.top + y, annotation.contents)
  }

  _showEditDialog(x, y, existingText) {
    // Remove any existing dialog (but keep editingAnnotation)
    this._removeDialog()

    // Create dialog
    this.noteDialog = document.createElement("div")
    this.noteDialog.className = "note-dialog"
    this.noteDialog.innerHTML = `
      <div class="note-dialog-header">
        <span>Edit Note</span>
        <button class="note-dialog-close" aria-label="Close">
          ${Icons.close}
        </button>
      </div>
      <textarea class="note-dialog-input" rows="4">${existingText || ""}</textarea>
      <div class="note-dialog-actions">
        <button class="note-dialog-save">Save</button>
      </div>
    `

    document.body.appendChild(this.noteDialog)

    // Position dialog, ensuring it stays within viewport bounds
    const { left, top } = this._constrainDialogPosition(x, y)
    this.noteDialog.style.cssText = `
      position: fixed;
      left: ${left}px;
      top: ${top}px;
      z-index: 1000;
    `

    // Focus and select all text after the browser finishes processing
    // Use preventScroll to avoid iOS Safari scrolling the page when focusing
    const textarea = this.noteDialog.querySelector(".note-dialog-input")
    requestAnimationFrame(() => {
      textarea.focus({ preventScroll: true })
      textarea.select()
    })

    // Set up event listeners for edit mode
    this._setupEditDialogListeners()
  }

  _setupEditDialogListeners() {
    const textarea = this.noteDialog.querySelector(".note-dialog-input")
    const closeBtn = this.noteDialog.querySelector(".note-dialog-close")
    const saveBtn = this.noteDialog.querySelector(".note-dialog-save")

    closeBtn.addEventListener("click", () => this._closeDialog())

    saveBtn.addEventListener("click", () => {
      const text = textarea.value.trim()
      if (text && this.editingAnnotation) {
        this._updateNote(this.editingAnnotation.id, text)
      }
      this._closeDialog()
    })

    textarea.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        const text = textarea.value.trim()
        if (text && this.editingAnnotation) {
          this._updateNote(this.editingAnnotation.id, text)
        }
        this._closeDialog()
      } else if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        this._closeDialog()
      }
    })
  }

  async _updateNote(annotationId, text) {
    await this.annotationManager.updateAnnotation(annotationId, {
      contents: text
    })
    this.editingAnnotation = null
  }

  destroy() {
    this._closeDialog()
    super.destroy()
  }
}
