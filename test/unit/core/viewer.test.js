import { describe, it, expect, vi, beforeEach } from "vitest"

/** A PDF.js stand-in. Documents are described by simple page descriptors. */
const pdfjsMock = vi.hoisted(() => {
  const state = {
    documents: new Map(),
    getDocument: null,
    PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 }
  }
  return state
})

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  PasswordResponses: pdfjsMock.PasswordResponses,
  getDocument: (...args) => pdfjsMock.getDocument(...args),
  renderTextLayer: vi.fn(() => ({ promise: Promise.resolve() })),
  TextLayer: class {
    constructor() { this.div = document.createElement("div") }
    render() { return Promise.resolve() }
  },
  AnnotationLayer: class { render() { return Promise.resolve() } }
}))

const { CoreViewer, ScaleValue } = await import("../../../src/lib/core/viewer.js")
const { ViewerEvents } = await import("../../../src/lib/core/event_bus.js")

/** Build a PDF.js document proxy over N pages of the given size. */
function makePdfDocument({ numPages = 3, width = 612, height = 792, rotate = 0, permissions = null } = {}) {
  return {
    numPages,
    getPermissions: vi.fn(async () => permissions),
    getPage: vi.fn(async (n) => ({
      pageNumber: n,
      rotate,
      getViewport: vi.fn(({ scale = 1, rotation = 0 } = {}) => {
        const swapped = rotation === 90 || rotation === 270
        return {
          width: (swapped ? height : width) * scale,
          height: (swapped ? width : height) * scale,
          scale,
          rotation
        }
      }),
      render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
      getTextContent: vi.fn(async () => ({ items: [] })),
      cleanup: vi.fn()
    })),
    destroy: vi.fn(async () => {}),
    cleanup: vi.fn()
  }
}

/**
 * Wire getDocument to resolve with the given document. Returns the loading
 * tasks it hands out: PDF.js tears a document down through its task, so that
 * is where teardown is observable.
 */
function resolveWith(pdfDocument) {
  const tasks = []
  pdfjsMock.getDocument = vi.fn(() => {
    const task = { promise: Promise.resolve(pdfDocument), destroy: vi.fn(async () => {}), onPassword: null }
    tasks.push(task)
    return task
  })
  return tasks
}

function rejectWith(error) {
  pdfjsMock.getDocument = vi.fn(() => ({
    promise: Promise.reject(error),
    destroy: vi.fn(async () => {}),
    onPassword: null
  }))
}

function makeContainer() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  Object.defineProperty(container, "clientWidth", { value: 800, configurable: true })
  Object.defineProperty(container, "clientHeight", { value: 600, configurable: true })
  return container
}

describe("CoreViewer", () => {
  let container

  beforeEach(() => {
    container = makeContainer()
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubGlobal("requestAnimationFrame", (cb) => { cb(0); return 1 })
  })

  describe("loading", () => {
    it("loads a document and reports its page count", async () => {
      resolveWith(makePdfDocument({ numPages: 5 }))
      const viewer = new CoreViewer(container)

      await viewer.load("/doc.pdf")

      expect(viewer.getPageCount()).toBe(5)
    })

    it("announces the loaded document", async () => {
      resolveWith(makePdfDocument({ numPages: 4 }))
      const viewer = new CoreViewer(container)
      const onLoaded = vi.fn()
      viewer.eventBus.on(ViewerEvents.DOCUMENT_LOADED, onLoaded)

      await viewer.load("/doc.pdf")

      expect(onLoaded).toHaveBeenCalledOnce()
      expect(onLoaded.mock.calls[0][0].pageCount).toBe(4)
    })

    it("creates a placeholder per page", async () => {
      resolveWith(makePdfDocument({ numPages: 3 }))
      const viewer = new CoreViewer(container)

      await viewer.load("/doc.pdf")

      expect(container.querySelectorAll(".pdf-page")).toHaveLength(3)
    })

    it("marks an encrypted document read-only", async () => {
      // getPermissions returns null only for unencrypted files.
      resolveWith(makePdfDocument({ permissions: ["print"] }))
      const viewer = new CoreViewer(container)

      await viewer.load("/doc.pdf")

      expect(viewer.isEncrypted).toBe(true)
    })

    it("leaves an unencrypted document writable", async () => {
      resolveWith(makePdfDocument({ permissions: null }))
      const viewer = new CoreViewer(container)

      await viewer.load("/doc.pdf")

      expect(viewer.isEncrypted).toBe(false)
    })

    it("announces and rethrows a load failure", async () => {
      const error = Object.assign(new Error("Invalid PDF structure"), { name: "InvalidPDFException" })
      rejectWith(error)
      const viewer = new CoreViewer(container)
      const onError = vi.fn()
      viewer.eventBus.on(ViewerEvents.DOCUMENT_LOAD_ERROR, onError)

      await expect(viewer.load("/doc.pdf")).rejects.toThrow("Invalid PDF structure")
      expect(onError).toHaveBeenCalledOnce()
    })
  })

  describe("blob fallback", () => {
    // Some corporate filters block PDF.js's range requests but allow plain GETs.
    it("retries as a full fetch after a network-shaped failure", async () => {
      const pdfDocument = makePdfDocument()
      let call = 0
      pdfjsMock.getDocument = vi.fn(() => {
        call++
        return call === 1
          ? { promise: Promise.reject(new Error("Failed to fetch")), destroy: vi.fn(), onPassword: null }
          : { promise: Promise.resolve(pdfDocument), destroy: vi.fn(), onPassword: null }
      })
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))

      const viewer = new CoreViewer(container)
      await viewer.load("/doc.pdf")

      expect(global.fetch).toHaveBeenCalledOnce()
      expect(viewer.pdfDocument).toBe(pdfDocument)
    })

    it("does not retry a password failure, where a new transport cannot help", async () => {
      rejectWith(Object.assign(new Error("No password given"), { name: "PasswordException" }))
      vi.stubGlobal("fetch", vi.fn())

      const viewer = new CoreViewer(container)
      await expect(viewer.load("/doc.pdf")).rejects.toThrow()

      expect(global.fetch).not.toHaveBeenCalled()
    })

    it("does not retry a corrupt file", async () => {
      rejectWith(Object.assign(new Error("Invalid PDF"), { name: "InvalidPDFException" }))
      vi.stubGlobal("fetch", vi.fn())

      const viewer = new CoreViewer(container)
      await expect(viewer.load("/doc.pdf")).rejects.toThrow()

      expect(global.fetch).not.toHaveBeenCalled()
    })

    it("does not retry an auth failure", async () => {
      rejectWith(new Error("Unexpected server response 403"))
      vi.stubGlobal("fetch", vi.fn())

      const viewer = new CoreViewer(container)
      await expect(viewer.load("/doc.pdf")).rejects.toThrow()

      expect(global.fetch).not.toHaveBeenCalled()
    })

    it("reports the failure when the fallback also fails", async () => {
      rejectWith(new Error("Failed to fetch"))
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })))

      const viewer = new CoreViewer(container)
      const onError = vi.fn()
      viewer.eventBus.on(ViewerEvents.DOCUMENT_LOAD_ERROR, onError)

      await expect(viewer.load("/doc.pdf")).rejects.toThrow("HTTP 500")
      expect(onError).toHaveBeenCalledOnce()
    })
  })

  describe("passwords", () => {
    function passwordDocument({ correct = "hunter2" } = {}) {
      const pdfDocument = makePdfDocument()

      // The task must be built when getDocument is called, not up front: the
      // viewer assigns onPassword immediately afterwards, and PDF.js only
      // invokes it once the caller has had that chance.
      pdfjsMock.getDocument = vi.fn(() => {
        const task = { promise: null, destroy: vi.fn(async () => {}), onPassword: null }
        task.promise = new Promise((resolve, reject) => {
          queueMicrotask(() => {
            if (!task.onPassword) return reject(new Error("No password given"))
            task.onPassword((passwordOrError) => {
              if (passwordOrError instanceof Error) reject(passwordOrError)
              else if (passwordOrError === correct) resolve(pdfDocument)
              else reject(new Error("Incorrect password"))
            }, pdfjsMock.PasswordResponses.NEED_PASSWORD)
          })
        })
        return task
      })

      return pdfDocument
    }

    it("asks the host for a password and loads with it", async () => {
      const pdfDocument = passwordDocument()
      const onPasswordRequest = vi.fn(async () => "hunter2")

      const viewer = new CoreViewer(container, { onPasswordRequest })
      await viewer.load("/doc.pdf")

      expect(onPasswordRequest).toHaveBeenCalledOnce()
      expect(viewer.pdfDocument).toBe(pdfDocument)
    })

    it("reports whether this is a retry after a wrong password", async () => {
      const pdfDocument = makePdfDocument()
      pdfjsMock.getDocument = vi.fn(() => {
        const task = { destroy: vi.fn(async () => {}), onPassword: null }
        task.promise = new Promise((resolve) => {
          queueMicrotask(() => {
            task.onPassword(() => resolve(pdfDocument), pdfjsMock.PasswordResponses.INCORRECT_PASSWORD)
          })
        })
        return task
      })
      const onPasswordRequest = vi.fn(async () => "pw")

      await new CoreViewer(container, { onPasswordRequest }).load("/doc.pdf")

      expect(onPasswordRequest).toHaveBeenCalledWith({ retry: true })
    })

    it("aborts the load when the user cancels", async () => {
      passwordDocument()
      const onPasswordRequest = vi.fn(async () => { throw new Error("Password entry cancelled") })

      const viewer = new CoreViewer(container, { onPasswordRequest })

      await expect(viewer.load("/doc.pdf")).rejects.toThrow("Password entry cancelled")
    })

    it("reuses a password from the streamed attempt in the blob fallback", async () => {
      // Otherwise the user is prompted twice for the same document.
      const pdfDocument = makePdfDocument()
      let call = 0
      const sources = []
      pdfjsMock.getDocument = vi.fn((source) => {
        call++
        sources.push(source)
        if (call === 1) {
          const task = { destroy: vi.fn(async () => {}), onPassword: null }
          task.promise = new Promise((_resolve, reject) => {
            queueMicrotask(() => {
              task.onPassword(() => reject(new Error("Failed to fetch")), pdfjsMock.PasswordResponses.NEED_PASSWORD)
            })
          })
          return task
        }
        return { promise: Promise.resolve(pdfDocument), destroy: vi.fn(), onPassword: null }
      })
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))

      const onPasswordRequest = vi.fn(async () => "hunter2")
      await new CoreViewer(container, { onPasswordRequest }).load("/doc.pdf")

      expect(onPasswordRequest).toHaveBeenCalledOnce()
      expect(sources[1].password).toBe("hunter2")
    })
  })

  describe("rotation", () => {
    it("adds the page's intrinsic rotation to the viewer's", async () => {
      // PDF.js treats the rotation option as absolute, so a landscape scan
      // stored as portrait + /Rotate 90 renders sideways without this.
      resolveWith(makePdfDocument({ rotate: 90 }))
      const viewer = new CoreViewer(container)
      await viewer.load("/doc.pdf")

      expect(viewer._rotationFor({ rotate: 90 })).toBe(90)
    })

    it("normalizes rotation into 0-359", async () => {
      resolveWith(makePdfDocument())
      const viewer = new CoreViewer(container)
      await viewer.load("/doc.pdf")

      viewer.rotation = 270
      expect(viewer._rotationFor({ rotate: 180 })).toBe(90)

      viewer.rotation = -90
      expect(viewer._rotationFor({ rotate: 0 })).toBe(270)
    })

    it("treats a page with no rotate value as unrotated", async () => {
      resolveWith(makePdfDocument())
      const viewer = new CoreViewer(container)
      await viewer.load("/doc.pdf")

      expect(viewer._rotationFor({})).toBe(0)
    })
  })

  describe("canvas clamping", () => {
    // Exceeding a browser's canvas limits silently yields a blank page.
    it("leaves a normal page at the requested device pixel ratio", () => {
      const viewer = new CoreViewer(container)

      expect(viewer._clampOutputScale(612, 792, 2)).toBe(2)
    })

    it("clamps by maximum side length", () => {
      const viewer = new CoreViewer(container)

      const scale = viewer._clampOutputScale(20000, 100, 2)

      expect(scale * 20000).toBeLessThanOrEqual(16384)
    })

    it("clamps by total area", () => {
      const viewer = new CoreViewer(container)

      const scale = viewer._clampOutputScale(5000, 5000, 3)

      expect(5000 * scale * 5000 * scale).toBeLessThanOrEqual(16_777_216 + 1)
    })

    it("drops below 1 for a page too large to render at full size", () => {
      const viewer = new CoreViewer(container)

      expect(viewer._clampOutputScale(10000, 10000, 1)).toBeLessThan(1)
    })

    it("never divides by zero on a degenerate page", () => {
      const viewer = new CoreViewer(container)

      expect(Number.isFinite(viewer._clampOutputScale(0, 0, 2))).toBe(true)
    })
  })

  describe("zoom", () => {
    it("starts at the configured initial scale", () => {
      const viewer = new CoreViewer(container, { initialScale: 1.5 })

      expect(viewer.getScale()).toBe(1.5)
    })

    it("announces a scale change", async () => {
      resolveWith(makePdfDocument())
      const viewer = new CoreViewer(container)
      await viewer.load("/doc.pdf")
      const onScale = vi.fn()
      viewer.eventBus.on(ViewerEvents.SCALE_CHANGED, onScale)

      viewer.setScale(2)

      expect(onScale).toHaveBeenCalledOnce()
      expect(onScale.mock.calls[0][0]).toMatchObject({ scale: 2, previousScale: 1 })
    })

    it("ignores a no-op scale change", async () => {
      resolveWith(makePdfDocument())
      const viewer = new CoreViewer(container)
      await viewer.load("/doc.pdf")
      const onScale = vi.fn()
      viewer.eventBus.on(ViewerEvents.SCALE_CHANGED, onScale)

      viewer.setScale(viewer.getScale())

      expect(onScale).not.toHaveBeenCalled()
    })

    it("publishes the scale as a CSS variable for the annotation layers", async () => {
      resolveWith(makePdfDocument())
      const viewer = new CoreViewer(container)
      await viewer.load("/doc.pdf")

      viewer.setScale(1.75)

      expect(container.style.getPropertyValue("--display-scale")).toBe("1.75")
    })

    it("resolves the fit presets to a numeric scale", async () => {
      resolveWith(makePdfDocument())
      const viewer = new CoreViewer(container)
      await viewer.load("/doc.pdf")

      for (const preset of [ScaleValue.PAGE_FIT, ScaleValue.PAGE_WIDTH, ScaleValue.AUTO]) {
        viewer.setScale(preset)
        expect(typeof viewer.getScale()).toBe("number")
        expect(viewer.getScale()).toBeGreaterThan(0)
      }
    })
  })

  describe("navigation", () => {
    it("reports page containers by number", async () => {
      resolveWith(makePdfDocument({ numPages: 3 }))
      const viewer = new CoreViewer(container)
      await viewer.load("/doc.pdf")

      expect(viewer.getPageContainer(2)?.dataset.pageNumber).toBe("2")
    })

    it("returns nothing for a page outside the document", async () => {
      resolveWith(makePdfDocument({ numPages: 3 }))
      const viewer = new CoreViewer(container)
      await viewer.load("/doc.pdf")

      expect(viewer.getPageContainer(99)).toBeFalsy()
    })

    it("starts on page 1", async () => {
      resolveWith(makePdfDocument())
      const viewer = new CoreViewer(container)
      await viewer.load("/doc.pdf")

      expect(viewer.getCurrentPage()).toBe(1)
    })

    it("ignores navigation outside the document", async () => {
      resolveWith(makePdfDocument({ numPages: 3 }))
      const viewer = new CoreViewer(container)
      await viewer.load("/doc.pdf")

      expect(() => viewer.goToPage(0)).not.toThrow()
      expect(() => viewer.goToPage(99)).not.toThrow()
    })
  })

  describe("destroy", () => {
    it("releases the PDF document through its loading task", async () => {
      // Destroying the task is what tears down the document and its worker
      // transport; destroying the proxy alone would leak the worker side.
      const tasks = resolveWith(makePdfDocument())
      const viewer = new CoreViewer(container)
      await viewer.load("/doc.pdf")

      viewer.destroy()
      await Promise.resolve()

      expect(tasks[0].destroy).toHaveBeenCalled()
    })

    it("is safe before any document is loaded", () => {
      const viewer = new CoreViewer(container)

      expect(() => viewer.destroy()).not.toThrow()
    })

    it("is safe to call twice", async () => {
      resolveWith(makePdfDocument())
      const viewer = new CoreViewer(container)
      await viewer.load("/doc.pdf")

      viewer.destroy()

      expect(() => viewer.destroy()).not.toThrow()
    })
  })

  describe("reloading", () => {
    it("releases the previous document so it is not orphaned", async () => {
      // Regression: reloading used to leave a whole PDF.js document and its
      // worker-side resources behind.
      const firstTasks = resolveWith(makePdfDocument())
      const viewer = new CoreViewer(container)
      await viewer.load("/first.pdf")

      resolveWith(makePdfDocument({ numPages: 7 }))
      await viewer.load("/second.pdf")

      expect(firstTasks[0].destroy).toHaveBeenCalled()
      expect(viewer.getPageCount()).toBe(7)
    })

    it("replaces the previous page placeholders", async () => {
      resolveWith(makePdfDocument({ numPages: 3 }))
      const viewer = new CoreViewer(container)
      await viewer.load("/first.pdf")

      resolveWith(makePdfDocument({ numPages: 5 }))
      await viewer.load("/second.pdf")

      expect(container.querySelectorAll(".pdf-page")).toHaveLength(5)
    })
  })
})
