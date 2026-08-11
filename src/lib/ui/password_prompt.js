/**
 * PasswordPrompt - Modal dialog for unlocking password-protected PDFs.
 *
 * Shown over the viewer when PDF.js requests a password during document
 * load. Each request() call returns a promise that resolves with the
 * entered password, or rejects when the user cancels.
 */

export class PasswordPrompt {
  constructor(options = {}) {
    this.container = options.container

    this.element = null
    this.inputElement = null
    this.errorElement = null

    this._pending = null // { resolve, reject } for the in-flight request

    this._createUI()
    this._setupEventListeners()
  }

  _createUI() {
    this.element = document.createElement("div")
    this.element.className = "pdf-password-prompt hidden"
    this.element.innerHTML = `
      <div class="pdf-password-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="pdf-password-prompt-title">
        <h2 class="pdf-password-prompt-title" id="pdf-password-prompt-title">Password required</h2>
        <p class="pdf-password-prompt-message">This document is protected. Enter the password to open it.</p>
        <p class="pdf-password-prompt-error hidden">Incorrect password. Please try again.</p>
        <input type="password" class="pdf-password-prompt-input" autocomplete="off" aria-label="Document password">
        <div class="pdf-password-prompt-buttons">
          <button type="button" class="pdf-password-prompt-btn pdf-password-prompt-cancel">Cancel</button>
          <button type="button" class="pdf-password-prompt-btn pdf-password-prompt-submit">Open</button>
        </div>
      </div>
    `

    this.inputElement = this.element.querySelector(".pdf-password-prompt-input")
    this.errorElement = this.element.querySelector(".pdf-password-prompt-error")
    this.submitButton = this.element.querySelector(".pdf-password-prompt-submit")
    this.cancelButton = this.element.querySelector(".pdf-password-prompt-cancel")

    this.container.appendChild(this.element)
  }

  _setupEventListeners() {
    this.submitButton.addEventListener("click", () => this._submit())
    this.cancelButton.addEventListener("click", () => this._cancel())

    this.element.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        this._submit()
      } else if (e.key === "Escape") {
        e.preventDefault()
        this._cancel()
      }
    })
  }

  /**
   * Ask the user for the document password.
   * @param {Object} options
   * @param {boolean} options.retry - Whether a previous attempt was incorrect
   * @returns {Promise<string>} Resolves with the password, rejects on cancel
   */
  request({ retry = false } = {}) {
    return new Promise((resolve, reject) => {
      // A request should never overlap another, but if it does, cancel the old one
      this._pending?.reject(new Error("Password entry cancelled"))
      this._pending = { resolve, reject }

      this.errorElement.classList.toggle("hidden", !retry)
      this.inputElement.value = ""
      this.element.classList.remove("hidden")
      this.inputElement.focus({ preventScroll: true })
    })
  }

  _submit() {
    const password = this.inputElement.value
    if (!password) {
      this.inputElement.focus({ preventScroll: true })
      return
    }

    const pending = this._pending
    this._pending = null
    this._hide()
    pending?.resolve(password)
  }

  _cancel() {
    const pending = this._pending
    this._pending = null
    this._hide()
    pending?.reject(new Error("Password entry cancelled"))
  }

  _hide() {
    this.element.classList.add("hidden")
    this.inputElement.value = ""
  }

  /**
   * Clean up. Safe to call multiple times.
   */
  destroy() {
    this._pending?.reject(new Error("Password entry cancelled"))
    this._pending = null
    this.element?.remove()
    this.element = null
  }
}
