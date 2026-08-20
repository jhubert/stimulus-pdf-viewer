import { describe, it, expect, vi, beforeEach } from "vitest"
import { AnnotationManager, AnnotationErrorType } from "../../src/lib/annotation_manager.js"
import { MemoryAnnotationStore } from "../../src/lib/stores/memory_annotation_store.js"
import { RestAnnotationStore } from "../../src/lib/stores/rest_annotation_store.js"
import { highlight, note, legacyUnderline, resetIds } from "../helpers/factories.js"

/** A store whose every method is a spy, seeded with the given records. */
function stubStore(records = []) {
  return {
    load: vi.fn().mockResolvedValue(records),
    create: vi.fn(async (data) => ({ id: 99, ...data })),
    update: vi.fn(async (id, data) => ({ id, page: 1, ...data })),
    delete: vi.fn(async (id) => ({ id })),
    restore: vi.fn(async (id) => ({ id, page: 1, annotation_type: "highlight" }))
  }
}

describe("AnnotationManager", () => {
  beforeEach(() => {
    resetIds()
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  describe("store selection", () => {
    it("prefers an explicitly supplied store", () => {
      const store = stubStore()
      expect(new AnnotationManager({ store }).store).toBe(store)
    })

    it("builds a REST store when given a URL", () => {
      const manager = new AnnotationManager({ annotationsUrl: "/annotations" })
      expect(manager.store).toBeInstanceOf(RestAnnotationStore)
      expect(manager.store.baseUrl).toBe("/annotations")
    })

    it("falls back to an in-memory store so the viewer works with no backend", () => {
      expect(new AnnotationManager().store).toBeInstanceOf(MemoryAnnotationStore)
    })

    it("prefers an explicit store over a URL", () => {
      const store = stubStore()
      const manager = new AnnotationManager({ store, annotationsUrl: "/annotations" })
      expect(manager.store).toBe(store)
    })
  })

  describe("loadAnnotations", () => {
    it("indexes annotations by id", async () => {
      const record = highlight({ id: 5 })
      const manager = new AnnotationManager({ store: stubStore([record]) })

      await manager.loadAnnotations()

      expect(manager.getAnnotation(5)).toEqual(record)
    })

    it("indexes annotations by page", async () => {
      const manager = new AnnotationManager({
        store: stubStore([highlight({ page: 1 }), highlight({ page: 2 }), note({ page: 2 })])
      })

      await manager.loadAnnotations()

      expect(manager.getAnnotationsForPage(1)).toHaveLength(1)
      expect(manager.getAnnotationsForPage(2)).toHaveLength(2)
    })

    it("returns an empty array for a page with no annotations", async () => {
      const manager = new AnnotationManager({ store: stubStore([]) })
      await manager.loadAnnotations()

      expect(manager.getAnnotationsForPage(42)).toEqual([])
    })

    it("replaces previous state rather than accumulating across loads", async () => {
      const store = stubStore([highlight({ id: 1 })])
      const manager = new AnnotationManager({ store })

      await manager.loadAnnotations()
      store.load.mockResolvedValue([highlight({ id: 2 })])
      await manager.loadAnnotations()

      expect(manager.getAllAnnotations()).toHaveLength(1)
      expect(manager.getAnnotation(1)).toBeUndefined()
      expect(manager.getAnnotation(2)).toBeTruthy()
    })

    it("normalizes legacy types on the way in", async () => {
      // Consumers' databases still hold pre-0.6 values; everything downstream
      // of the manager is entitled to assume canonical ones.
      const manager = new AnnotationManager({ store: stubStore([legacyUnderline({ id: 3 })]) })

      await manager.loadAnnotations()

      expect(manager.getAnnotation(3).annotation_type).toBe("underline")
    })

    it("reports and rethrows load failures", async () => {
      const store = stubStore()
      store.load.mockRejectedValue(new Error("boom"))
      const target = document.createElement("div")
      const onError = vi.fn()
      target.addEventListener("pdf-viewer:error", onError)

      const manager = new AnnotationManager({ store, eventTarget: target })

      await expect(manager.loadAnnotations()).rejects.toThrow("boom")
      expect(onError).toHaveBeenCalledOnce()
      expect(onError.mock.calls[0][0].detail.errorType).toBe(AnnotationErrorType.LOAD_FAILED)
    })
  })

  describe("id normalization", () => {
    // Ids arrive as numbers from JSON but as strings from DOM datasets and
    // Stimulus values. Regression for deep-links that never resolved.
    it("finds a numeric id looked up as a string", async () => {
      const manager = new AnnotationManager({ store: stubStore([highlight({ id: 42 })]) })
      await manager.loadAnnotations()

      expect(manager.getAnnotation("42")).toBeTruthy()
      expect(manager.getAnnotation(42)).toBeTruthy()
    })

    it("finds a string id looked up as a number", async () => {
      const manager = new AnnotationManager({ store: stubStore([highlight({ id: "42" })]) })
      await manager.loadAnnotations()

      expect(manager.getAnnotation(42)).toBeTruthy()
    })

    it("deletes by either id type", async () => {
      const store = stubStore([highlight({ id: 42 })])
      const manager = new AnnotationManager({ store })
      await manager.loadAnnotations()

      await manager.deleteAnnotation("42")

      expect(manager.getAnnotation(42)).toBeUndefined()
    })
  })

  describe("createAnnotation", () => {
    it("returns the stored record, not the submitted payload", async () => {
      const store = stubStore()
      const manager = new AnnotationManager({ store })

      const created = await manager.createAnnotation({ page: 1, annotation_type: "highlight" })

      expect(created.id).toBe(99)
      expect(store.create).toHaveBeenCalledWith({ page: 1, annotation_type: "highlight" })
    })

    it("adds the annotation to both indexes", async () => {
      const manager = new AnnotationManager({ store: stubStore() })

      await manager.createAnnotation({ page: 4, annotation_type: "note" })

      expect(manager.getAnnotation(99)).toBeTruthy()
      expect(manager.getAnnotationsForPage(4)).toHaveLength(1)
    })

    it("normalizes a legacy type returned by the server", async () => {
      const store = stubStore()
      store.create.mockResolvedValue(legacyUnderline({ id: 99 }))
      const manager = new AnnotationManager({ store })

      const created = await manager.createAnnotation({})

      expect(created.annotation_type).toBe("underline")
    })

    it("invokes the created callback", async () => {
      const onAnnotationCreated = vi.fn()
      const manager = new AnnotationManager({ store: stubStore(), onAnnotationCreated })

      await manager.createAnnotation({ page: 1 })

      expect(onAnnotationCreated).toHaveBeenCalledOnce()
    })

    it("reports and rethrows create failures without indexing anything", async () => {
      const store = stubStore()
      store.create.mockRejectedValue(new Error("nope"))
      const manager = new AnnotationManager({ store })

      await expect(manager.createAnnotation({ page: 1 })).rejects.toThrow("nope")
      expect(manager.getAllAnnotations()).toEqual([])
    })
  })

  describe("updateAnnotation", () => {
    it("replaces the indexed record", async () => {
      const store = stubStore([highlight({ id: 1, contents: "before" })])
      const manager = new AnnotationManager({ store })
      await manager.loadAnnotations()

      await manager.updateAnnotation(1, { contents: "after" })

      expect(manager.getAnnotation(1).contents).toBe("after")
    })

    it("moves the annotation between page indexes when the page changes", async () => {
      const store = stubStore([highlight({ id: 1, page: 1 })])
      store.update.mockResolvedValue(highlight({ id: 1, page: 2 }))
      const manager = new AnnotationManager({ store })
      await manager.loadAnnotations()

      await manager.updateAnnotation(1, { page: 2 })

      expect(manager.getAnnotationsForPage(1)).toHaveLength(0)
      expect(manager.getAnnotationsForPage(2)).toHaveLength(1)
    })

    it("does not duplicate the annotation when the page is unchanged", async () => {
      const store = stubStore([highlight({ id: 1, page: 1 })])
      store.update.mockResolvedValue(highlight({ id: 1, page: 1, contents: "x" }))
      const manager = new AnnotationManager({ store })
      await manager.loadAnnotations()

      await manager.updateAnnotation(1, { contents: "x" })

      expect(manager.getAnnotationsForPage(1)).toHaveLength(1)
    })

    it("indexes an update for an annotation it has never seen", async () => {
      const store = stubStore([])
      store.update.mockResolvedValue(highlight({ id: 77, page: 3 }))
      const manager = new AnnotationManager({ store })
      await manager.loadAnnotations()

      await manager.updateAnnotation(77, {})

      expect(manager.getAnnotation(77)).toBeTruthy()
      expect(manager.getAnnotationsForPage(3)).toHaveLength(1)
    })

    it("invokes the updated callback", async () => {
      const onAnnotationUpdated = vi.fn()
      const manager = new AnnotationManager({ store: stubStore(), onAnnotationUpdated })

      await manager.updateAnnotation(1, { contents: "x" })

      expect(onAnnotationUpdated).toHaveBeenCalledOnce()
    })

    it("reports and rethrows update failures", async () => {
      const store = stubStore()
      store.update.mockRejectedValue(new Error("nope"))
      const manager = new AnnotationManager({ store })

      await expect(manager.updateAnnotation(1, {})).rejects.toThrow("nope")
    })
  })

  describe("deleteAnnotation", () => {
    it("removes the annotation from both indexes", async () => {
      const manager = new AnnotationManager({ store: stubStore([highlight({ id: 1, page: 2 })]) })
      await manager.loadAnnotations()

      await manager.deleteAnnotation(1)

      expect(manager.getAnnotation(1)).toBeUndefined()
      expect(manager.getAnnotationsForPage(2)).toHaveLength(0)
    })

    it("returns the annotation as it was before deletion", async () => {
      // The undo bar needs the full record to describe what was removed.
      const record = highlight({ id: 1, contents: "gone" })
      const manager = new AnnotationManager({ store: stubStore([record]) })
      await manager.loadAnnotations()

      const deleted = await manager.deleteAnnotation(1)

      expect(deleted.contents).toBe("gone")
    })

    it("is a no-op for an unknown id and never reaches the store", async () => {
      const store = stubStore([])
      const manager = new AnnotationManager({ store })
      await manager.loadAnnotations()

      await expect(manager.deleteAnnotation(404)).resolves.toBeUndefined()
      expect(store.delete).not.toHaveBeenCalled()
    })

    it("invokes the deleted callback with the removed record", async () => {
      const onAnnotationDeleted = vi.fn()
      const manager = new AnnotationManager({
        store: stubStore([highlight({ id: 1 })]),
        onAnnotationDeleted
      })
      await manager.loadAnnotations()

      await manager.deleteAnnotation(1)

      expect(onAnnotationDeleted).toHaveBeenCalledOnce()
      expect(onAnnotationDeleted.mock.calls[0][0].id).toBe(1)
    })

    it("keeps the annotation indexed when the store rejects", async () => {
      // A failed delete must not leave the UI showing an annotation gone that
      // the server still has.
      const store = stubStore([highlight({ id: 1 })])
      store.delete.mockRejectedValue(new Error("nope"))
      const manager = new AnnotationManager({ store })
      await manager.loadAnnotations()

      await expect(manager.deleteAnnotation(1)).rejects.toThrow("nope")
      expect(manager.getAnnotation(1)).toBeTruthy()
    })
  })

  describe("restoreAnnotation", () => {
    it("re-indexes the restored annotation", async () => {
      const store = stubStore([])
      store.restore.mockResolvedValue(highlight({ id: 1, page: 3 }))
      const manager = new AnnotationManager({ store })

      await manager.restoreAnnotation(1)

      expect(manager.getAnnotation(1)).toBeTruthy()
      expect(manager.getAnnotationsForPage(3)).toHaveLength(1)
    })

    it("normalizes a legacy type on restore", async () => {
      const store = stubStore([])
      store.restore.mockResolvedValue(legacyUnderline({ id: 1 }))
      const manager = new AnnotationManager({ store })

      const restored = await manager.restoreAnnotation(1)

      expect(restored.annotation_type).toBe("underline")
    })

    it("returns null and indexes nothing when the store cannot restore", async () => {
      // The memory store returns null; undo must degrade quietly rather than
      // inserting an empty annotation.
      const store = stubStore([])
      store.restore.mockResolvedValue(null)
      const manager = new AnnotationManager({ store })

      await expect(manager.restoreAnnotation(1)).resolves.toBeNull()
      expect(manager.getAllAnnotations()).toEqual([])
    })

    it("reports and rethrows restore failures", async () => {
      const store = stubStore()
      store.restore.mockRejectedValue(new Error("nope"))
      const manager = new AnnotationManager({ store })

      await expect(manager.restoreAnnotation(1)).rejects.toThrow("nope")
    })
  })

  describe("error events", () => {
    it("carries the failure type, message, and original error", async () => {
      const store = stubStore()
      const cause = new Error("underlying")
      store.create.mockRejectedValue(cause)
      const target = document.createElement("div")
      const onError = vi.fn()
      target.addEventListener("pdf-viewer:error", onError)

      const manager = new AnnotationManager({ store, eventTarget: target })
      await expect(manager.createAnnotation({})).rejects.toThrow()

      const { detail } = onError.mock.calls[0][0]
      expect(detail.errorType).toBe(AnnotationErrorType.CREATE_FAILED)
      expect(detail.message).toBe("Failed to save annotation")
      expect(detail.error).toBe(cause)
      expect(detail.source).toBe("annotation_manager")
    })

    it("still rejects when no event target is configured", async () => {
      const store = stubStore()
      store.create.mockRejectedValue(new Error("nope"))
      const manager = new AnnotationManager({ store })

      await expect(manager.createAnnotation({})).rejects.toThrow("nope")
    })

    it("bubbles so a host app can listen on an ancestor", async () => {
      const parent = document.createElement("div")
      const target = document.createElement("div")
      parent.appendChild(target)
      document.body.appendChild(parent)
      const onError = vi.fn()
      parent.addEventListener("pdf-viewer:error", onError)

      const store = stubStore()
      store.create.mockRejectedValue(new Error("nope"))
      const manager = new AnnotationManager({ store, eventTarget: target })
      await expect(manager.createAnnotation({})).rejects.toThrow()

      expect(onError).toHaveBeenCalledOnce()
    })
  })

  describe("getAllAnnotations", () => {
    it("returns every indexed annotation across pages", async () => {
      const manager = new AnnotationManager({
        store: stubStore([highlight({ page: 1 }), note({ page: 2 })])
      })
      await manager.loadAnnotations()

      expect(manager.getAllAnnotations()).toHaveLength(2)
    })
  })

  it("works end to end against the real memory store", async () => {
    const manager = new AnnotationManager({ store: new MemoryAnnotationStore() })
    await manager.loadAnnotations()

    const created = await manager.createAnnotation({ page: 1, annotation_type: "note", contents: "hi" })
    await manager.updateAnnotation(created.id, { contents: "edited" })

    expect(manager.getAnnotation(created.id).contents).toBe("edited")

    await manager.deleteAnnotation(created.id)

    expect(manager.getAllAnnotations()).toEqual([])
  })
})
