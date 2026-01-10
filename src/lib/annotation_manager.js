import { FetchRequest } from "@rails/request.js"

// Custom event types for error handling
export const AnnotationErrorType = {
  LOAD_FAILED: "load_failed",
  CREATE_FAILED: "create_failed",
  UPDATE_FAILED: "update_failed",
  DELETE_FAILED: "delete_failed",
  RESTORE_FAILED: "restore_failed"
}

export class AnnotationManager {
  constructor(options = {}) {
    this.annotationsUrl = options.annotationsUrl
    this.documentId = options.documentId
    this.onAnnotationCreated = options.onAnnotationCreated
    this.onAnnotationUpdated = options.onAnnotationUpdated
    this.onAnnotationDeleted = options.onAnnotationDeleted
    this.eventTarget = options.eventTarget // Optional element for dispatching events

    this.annotations = new Map() // id -> annotation
    this.annotationsByPage = new Map() // pageNumber -> [annotations]
  }

  /**
   * Dispatch an error event for UI feedback and logging.
   */
  _dispatchError(errorType, message, originalError) {
    if (this.eventTarget) {
      this.eventTarget.dispatchEvent(new CustomEvent("pdf-viewer:error", {
        bubbles: true,
        detail: {
          source: "annotation_manager",
          errorType,
          message,
          error: originalError
        }
      }))
    }
  }

  async loadAnnotations() {
    try {
      const request = new FetchRequest("get", `${this.annotationsUrl}.json`)
      const response = await request.perform()

      if (response.ok) {
        const data = await response.json
        this._processAnnotations(data)
      } else {
        throw new Error("Server returned an error")
      }
    } catch (error) {
      console.error("Failed to load annotations:", error)
      this._dispatchError(AnnotationErrorType.LOAD_FAILED, "Failed to load annotations", error)
      throw error
    }
  }

  _processAnnotations(annotationsData) {
    this.annotations.clear()
    this.annotationsByPage.clear()

    for (const annotation of annotationsData) {
      this.annotations.set(annotation.id, annotation)

      if (!this.annotationsByPage.has(annotation.page)) {
        this.annotationsByPage.set(annotation.page, [])
      }
      this.annotationsByPage.get(annotation.page).push(annotation)
    }
  }

  getAnnotation(id) {
    return this.annotations.get(id)
  }

  getAnnotationsForPage(pageNumber) {
    return this.annotationsByPage.get(pageNumber) || []
  }

  getAllAnnotations() {
    return Array.from(this.annotations.values())
  }

  async createAnnotation(data) {
    try {
      const request = new FetchRequest("post", this.annotationsUrl, {
        body: JSON.stringify({ annotation: data }),
        contentType: "application/json",
        responseKind: "json"
      })

      const response = await request.perform()

      if (response.ok) {
        const annotation = await response.json
        this._addAnnotation(annotation)

        if (this.onAnnotationCreated) {
          this.onAnnotationCreated(annotation)
        }

        return annotation
      } else {
        throw new Error("Failed to create annotation")
      }
    } catch (error) {
      console.error("Failed to create annotation:", error)
      this._dispatchError(AnnotationErrorType.CREATE_FAILED, "Failed to save annotation", error)
      throw error
    }
  }

  async updateAnnotation(id, data) {
    try {
      const request = new FetchRequest("patch", `${this.annotationsUrl}/${id}`, {
        body: JSON.stringify({ annotation: data }),
        contentType: "application/json",
        responseKind: "json"
      })

      const response = await request.perform()

      if (response.ok) {
        const annotation = await response.json
        this._updateAnnotation(annotation)

        if (this.onAnnotationUpdated) {
          this.onAnnotationUpdated(annotation)
        }

        return annotation
      } else {
        throw new Error("Failed to update annotation")
      }
    } catch (error) {
      console.error("Failed to update annotation:", error)
      this._dispatchError(AnnotationErrorType.UPDATE_FAILED, "Failed to update annotation", error)
      throw error
    }
  }

  async deleteAnnotation(id) {
    try {
      const annotation = this.annotations.get(id)
      if (!annotation) return

      const request = new FetchRequest("delete", `${this.annotationsUrl}/${id}`, {
        responseKind: "json"
      })
      const response = await request.perform()

      if (response.ok) {
        this._removeAnnotation(id)

        if (this.onAnnotationDeleted) {
          this.onAnnotationDeleted(annotation)
        }

        return annotation
      } else {
        throw new Error("Failed to delete annotation")
      }
    } catch (error) {
      console.error("Failed to delete annotation:", error)
      this._dispatchError(AnnotationErrorType.DELETE_FAILED, "Failed to delete annotation", error)
      throw error
    }
  }

  async restoreAnnotation(id) {
    try {
      const request = new FetchRequest("patch", `${this.annotationsUrl}/${id}/restore`, {
        responseKind: "json"
      })
      const response = await request.perform()

      if (response.ok) {
        const annotation = await response.json
        this._addAnnotation(annotation)

        if (this.onAnnotationCreated) {
          this.onAnnotationCreated(annotation)
        }

        return annotation
      } else {
        throw new Error("Failed to restore annotation")
      }
    } catch (error) {
      console.error("Failed to restore annotation:", error)
      this._dispatchError(AnnotationErrorType.RESTORE_FAILED, "Failed to restore annotation", error)
      throw error
    }
  }

  _addAnnotation(annotation) {
    this.annotations.set(annotation.id, annotation)

    if (!this.annotationsByPage.has(annotation.page)) {
      this.annotationsByPage.set(annotation.page, [])
    }
    this.annotationsByPage.get(annotation.page).push(annotation)
  }

  _updateAnnotation(annotation) {
    const oldAnnotation = this.annotations.get(annotation.id)
    if (!oldAnnotation) {
      this._addAnnotation(annotation)
      return
    }

    // Remove from old page if page changed
    if (oldAnnotation.page !== annotation.page) {
      this._removeAnnotationFromPage(oldAnnotation.id, oldAnnotation.page)

      if (!this.annotationsByPage.has(annotation.page)) {
        this.annotationsByPage.set(annotation.page, [])
      }
      this.annotationsByPage.get(annotation.page).push(annotation)
    } else {
      // Update in place
      const pageAnnotations = this.annotationsByPage.get(annotation.page)
      const index = pageAnnotations.findIndex(a => a.id === annotation.id)
      if (index !== -1) {
        pageAnnotations[index] = annotation
      }
    }

    this.annotations.set(annotation.id, annotation)
  }

  _removeAnnotation(id) {
    const annotation = this.annotations.get(id)
    if (!annotation) return

    this._removeAnnotationFromPage(id, annotation.page)
    this.annotations.delete(id)
  }

  _removeAnnotationFromPage(id, pageNumber) {
    const pageAnnotations = this.annotationsByPage.get(pageNumber)
    if (pageAnnotations) {
      const index = pageAnnotations.findIndex(a => a.id === id)
      if (index !== -1) {
        pageAnnotations.splice(index, 1)
      }
    }
  }
}
