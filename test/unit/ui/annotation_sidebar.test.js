import { describe, it, expect, vi, beforeEach } from "vitest"
import { AnnotationSidebar } from "../../../src/lib/ui/annotation_sidebar.js"
import { highlight, underline, note, ink, freeHighlight, resetIds } from "../../helpers/factories.js"

function makeSidebar(annotations = [], options = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)

  const annotationManager = {
    getAllAnnotations: vi.fn(() => annotations),
    getAnnotation: vi.fn((id) => annotations.find(a => String(a.id) === String(id)))
  }

  const sidebar = new AnnotationSidebar({
    container,
    annotationManager,
    onAnnotationClick: options.onAnnotationClick || vi.fn(),
    ...options
  })

  return { sidebar, container, annotationManager }
}

const items = (sidebar) => Array.from(sidebar.listContainer.querySelectorAll("[data-annotation-id]"))
const labels = (sidebar) => items(sidebar).map(el => el.textContent)

describe("AnnotationSidebar", () => {
  beforeEach(() => {
    resetIds()
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  describe("rendering", () => {
    it("lists one item per annotation", () => {
      const { sidebar } = makeSidebar([highlight(), note(), ink()])
      sidebar._refreshList()

      expect(items(sidebar)).toHaveLength(3)
    })

    it("reports the annotation count", () => {
      const { sidebar } = makeSidebar([highlight(), note()])
      sidebar._refreshList()

      expect(sidebar.getCount()).toBe(2)
    })

    it("renders nothing but an empty state when there are no annotations", () => {
      const { sidebar } = makeSidebar([])
      sidebar._refreshList()

      expect(items(sidebar)).toHaveLength(0)
    })

    it("tags each item with its annotation id for click routing", () => {
      const { sidebar } = makeSidebar([highlight({ id: 42 })])
      sidebar._refreshList()

      expect(items(sidebar)[0].dataset.annotationId).toBe("42")
    })
  })

  describe("display text", () => {
    it("shows a highlight's selected text", () => {
      const { sidebar } = makeSidebar([highlight({ title: "the quick brown fox" })])
      sidebar._refreshList()

      expect(labels(sidebar)[0]).toContain("the quick brown fox")
    })

    it("shows a note's contents", () => {
      const { sidebar } = makeSidebar([note({ contents: "remember this" })])
      sidebar._refreshList()

      expect(labels(sidebar)[0]).toContain("remember this")
    })

    it("labels an empty note rather than showing a blank row", () => {
      const { sidebar } = makeSidebar([note({ contents: null })])
      sidebar._refreshList()

      expect(labels(sidebar)[0]).toContain("Empty note")
    })

    it("labels a drawing, which has no text of its own", () => {
      const { sidebar } = makeSidebar([ink()])
      sidebar._refreshList()

      expect(labels(sidebar)[0]).toContain("Ink drawing")
    })

    it("presents a free highlight as a highlight, not a drawing", () => {
      const { sidebar } = makeSidebar([freeHighlight({ title: null, contents: null })])
      sidebar._refreshList()

      expect(labels(sidebar)[0]).toContain("Freehand Highlight")
    })

    it("labels an underline with its selected text", () => {
      const { sidebar } = makeSidebar([underline({ title: "underlined words" })])
      sidebar._refreshList()

      expect(labels(sidebar)[0]).toContain("underlined words")
    })

    it("truncates long text", () => {
      const { sidebar } = makeSidebar([highlight({ title: "x".repeat(200) })])
      sidebar._refreshList()

      expect(labels(sidebar)[0]).toContain("...")
      expect(labels(sidebar)[0]).not.toContain("x".repeat(100))
    })

    it("collapses whitespace so multi-line selections read as one line", () => {
      const { sidebar } = makeSidebar([highlight({ title: "line one\n\n   line two" })])
      sidebar._refreshList()

      expect(labels(sidebar)[0]).toContain("line one line two")
    })
  })

  describe("escaping", () => {
    // Annotation text is untrusted: it comes from other users via the API.
    it("does not execute markup in a note body", () => {
      const { sidebar } = makeSidebar([note({ contents: "<img src=x onerror=alert(1)>" })])
      sidebar._refreshList()

      expect(sidebar.listContainer.querySelector("img")).toBeNull()
    })

    it("does not execute markup in a highlight title", () => {
      const { sidebar } = makeSidebar([highlight({ title: "<script>alert(1)</script>" })])
      sidebar._refreshList()

      expect(sidebar.listContainer.querySelector("script")).toBeNull()
    })

    it("renders the markup as visible text instead", () => {
      const { sidebar } = makeSidebar([note({ contents: "<b>bold</b>" })])
      sidebar._refreshList()

      expect(sidebar.listContainer.querySelector("b")).toBeNull()
      expect(labels(sidebar)[0]).toContain("<b>bold</b>")
    })

    it("rejects a non-hex color rather than injecting it into markup", () => {
      const { sidebar } = makeSidebar([highlight({ color: 'red"><img src=x onerror=alert(1)>' })])
      sidebar._refreshList()

      expect(sidebar.listContainer.querySelector("img")).toBeNull()
    })
  })

  describe("filtering", () => {
    const all = () => [highlight(), underline(), note(), ink(), freeHighlight()]

    it("shows everything by default", () => {
      const { sidebar } = makeSidebar(all())
      sidebar._refreshList()

      expect(items(sidebar)).toHaveLength(5)
    })

    it("counts a free highlight under highlights, not drawings", () => {
      // It is stored as ink but authored with the highlighter.
      const { sidebar } = makeSidebar(all())
      sidebar.filterType = "highlight"
      sidebar._refreshList()

      expect(items(sidebar)).toHaveLength(2)
    })

    it("excludes free highlights from the drawing filter", () => {
      const { sidebar } = makeSidebar(all())
      sidebar.filterType = "drawing"
      sidebar._refreshList()

      expect(items(sidebar)).toHaveLength(1)
    })

    it("filters notes", () => {
      const { sidebar } = makeSidebar(all())
      sidebar.filterType = "note"
      sidebar._refreshList()

      expect(items(sidebar)).toHaveLength(1)
    })

    it("filters underlines", () => {
      const { sidebar } = makeSidebar(all())
      sidebar.filterType = "underline"
      sidebar._refreshList()

      expect(items(sidebar)).toHaveLength(1)
    })

    it("shows nothing when no annotation matches", () => {
      const { sidebar } = makeSidebar([note(), note()])
      sidebar.filterType = "underline"
      sidebar._refreshList()

      expect(items(sidebar)).toHaveLength(0)
    })
  })

  describe("sorting", () => {
    it("orders by page number by default", () => {
      const { sidebar } = makeSidebar([
        highlight({ id: 1, page: 3 }), highlight({ id: 2, page: 1 }), highlight({ id: 3, page: 2 })
      ])
      sidebar._refreshList()

      expect(items(sidebar).map(el => el.dataset.annotationId)).toEqual(["2", "3", "1"])
    })

    it("orders top to bottom within a page", () => {
      const { sidebar } = makeSidebar([
        highlight({ id: 1, page: 1, rect: [0, 500, 100, 20] }),
        highlight({ id: 2, page: 1, rect: [0, 100, 100, 20] })
      ])
      sidebar._refreshList()

      expect(items(sidebar).map(el => el.dataset.annotationId)).toEqual(["2", "1"])
    })

    it("falls back to quad position when a record has no rect", () => {
      const { sidebar } = makeSidebar([
        highlight({ id: 1, page: 1, rect: null, quads: [{ p1: { x: 0, y: 300 }, p2: {}, p3: {}, p4: {} }] }),
        highlight({ id: 2, page: 1, rect: null, quads: [{ p1: { x: 0, y: 100 }, p2: {}, p3: {}, p4: {} }] })
      ])
      sidebar._refreshList()

      expect(items(sidebar).map(el => el.dataset.annotationId)).toEqual(["2", "1"])
    })

    it("falls back to the first ink point when there is no rect or quad", () => {
      const { sidebar } = makeSidebar([
        ink({ id: 1, page: 1, rect: null, ink_strokes: [{ points: [{ x: 0, y: 400 }] }] }),
        ink({ id: 2, page: 1, rect: null, ink_strokes: [{ points: [{ x: 0, y: 50 }] }] })
      ])
      sidebar._refreshList()

      expect(items(sidebar).map(el => el.dataset.annotationId)).toEqual(["2", "1"])
    })

    it("sorts newest first", () => {
      const { sidebar } = makeSidebar([
        highlight({ id: 1, created_at: "2026-01-01T00:00:00Z" }),
        highlight({ id: 2, created_at: "2026-06-01T00:00:00Z" })
      ])
      sidebar.sortMode = "newest"
      sidebar._refreshList()

      expect(items(sidebar).map(el => el.dataset.annotationId)).toEqual(["2", "1"])
    })

    it("sorts oldest first", () => {
      const { sidebar } = makeSidebar([
        highlight({ id: 1, created_at: "2026-06-01T00:00:00Z" }),
        highlight({ id: 2, created_at: "2026-01-01T00:00:00Z" })
      ])
      sidebar.sortMode = "oldest"
      sidebar._refreshList()

      expect(items(sidebar).map(el => el.dataset.annotationId)).toEqual(["2", "1"])
    })

    it("does not mutate the manager's array while sorting", () => {
      const annotations = [highlight({ id: 1, page: 3 }), highlight({ id: 2, page: 1 })]
      const { sidebar } = makeSidebar(annotations)
      sidebar._refreshList()

      expect(annotations.map(a => a.id)).toEqual([1, 2])
    })
  })

  describe("selection", () => {
    it("marks the clicked item as selected", () => {
      const { sidebar } = makeSidebar([highlight({ id: 1 }), highlight({ id: 2 })])
      sidebar.open()
      sidebar._refreshList()

      sidebar.selectAnnotation(2, { scroll: false })

      const selected = items(sidebar).filter(el => el.classList.contains("selected"))
      expect(selected).toHaveLength(1)
      expect(selected[0].dataset.annotationId).toBe("2")
    })

    it("accepts a numeric id even though the DOM stores strings", () => {
      // Regression: deep-links passed string ids and never matched.
      const { sidebar } = makeSidebar([highlight({ id: 42 })])
      sidebar.open()
      sidebar._refreshList()

      sidebar.selectAnnotation(42, { scroll: false })

      expect(items(sidebar)[0].classList.contains("selected")).toBe(true)
    })

    it("accepts a string id too", () => {
      const { sidebar } = makeSidebar([highlight({ id: 42 })])
      sidebar.open()
      sidebar._refreshList()

      sidebar.selectAnnotation("42", { scroll: false })

      expect(items(sidebar)[0].classList.contains("selected")).toBe(true)
    })

    it("moves the selection rather than accumulating it", () => {
      const { sidebar } = makeSidebar([highlight({ id: 1 }), highlight({ id: 2 })])
      sidebar.open()
      sidebar._refreshList()

      sidebar.selectAnnotation(1, { scroll: false })
      sidebar.selectAnnotation(2, { scroll: false })

      expect(items(sidebar).filter(el => el.classList.contains("selected"))).toHaveLength(1)
    })

    it("notifies the host when an item is clicked", () => {
      const onAnnotationClick = vi.fn()
      const { sidebar } = makeSidebar([highlight({ id: 7 })], { onAnnotationClick })
      sidebar._refreshList()

      items(sidebar)[0].click()

      expect(onAnnotationClick).toHaveBeenCalledOnce()
    })
  })

  describe("live updates", () => {
    // The hooks only refresh while the sidebar is open; a closed list is
    // rebuilt from scratch on open, so refreshing it early would be wasted.
    it("adds a newly created annotation to the list", () => {
      const annotations = [highlight({ id: 1 })]
      const { sidebar } = makeSidebar(annotations)
      sidebar.open()
      sidebar._refreshList()

      annotations.push(note({ id: 2 }))
      sidebar.onAnnotationCreated(annotations[1])

      expect(items(sidebar)).toHaveLength(2)
    })

    it("drops a deleted annotation from the list", () => {
      const annotations = [highlight({ id: 1 }), note({ id: 2 })]
      const { sidebar } = makeSidebar(annotations)
      sidebar.open()
      sidebar._refreshList()

      const [removed] = annotations.splice(0, 1)
      sidebar.onAnnotationDeleted(removed)

      expect(items(sidebar)).toHaveLength(1)
    })

    it("does not rebuild a closed list", () => {
      const annotations = [highlight({ id: 1 })]
      const { sidebar } = makeSidebar(annotations)

      annotations.push(note({ id: 2 }))
      sidebar.onAnnotationCreated(annotations[1])

      expect(items(sidebar)).toHaveLength(0)
    })

    it("reflects edited contents", () => {
      const annotations = [note({ id: 1, contents: "before" })]
      const { sidebar } = makeSidebar(annotations)
      sidebar.open()
      sidebar._refreshList()

      annotations[0].contents = "after"
      sidebar.onAnnotationUpdated(annotations[0])

      expect(labels(sidebar)[0]).toContain("after")
    })
  })

  describe("open and close", () => {
    it("starts closed", () => {
      const { sidebar } = makeSidebar([])

      expect(sidebar.isOpen).toBe(false)
    })

    it("opens and closes", () => {
      const { sidebar } = makeSidebar([])

      sidebar.open()
      expect(sidebar.isOpen).toBe(true)

      sidebar.close()
      expect(sidebar.isOpen).toBe(false)
    })

    it("toggles", () => {
      const { sidebar } = makeSidebar([])

      sidebar.toggle()
      expect(sidebar.isOpen).toBe(true)

      sidebar.toggle()
      expect(sidebar.isOpen).toBe(false)
    })
  })

  describe("custom item template", () => {
    it("uses the host's markup and fills its data-field slots", () => {
      const itemTemplate = document.createElement("template")
      itemTemplate.innerHTML = `<li class="custom"><span data-field="label"></span><span data-field="page"></span></li>`

      const { sidebar } = makeSidebar([highlight({ id: 1, page: 4, title: "custom text" })], { itemTemplate })
      sidebar._refreshList()

      const item = sidebar.listContainer.querySelector("li.custom")
      expect(item).toBeTruthy()
      expect(item.querySelector('[data-field="label"]').textContent).toContain("custom text")
      expect(item.querySelector('[data-field="page"]').textContent).toContain("4")
    })

    it("makes template items keyboard focusable", () => {
      const itemTemplate = document.createElement("template")
      itemTemplate.innerHTML = `<li class="custom"><span data-field="label"></span></li>`

      const { sidebar } = makeSidebar([highlight()], { itemTemplate })
      sidebar._refreshList()

      expect(sidebar.listContainer.querySelector("li.custom").tabIndex).toBe(0)
    })

    it("escapes untrusted text inside a custom template too", () => {
      const itemTemplate = document.createElement("template")
      itemTemplate.innerHTML = `<li class="custom"><span data-field="label"></span></li>`

      const { sidebar } = makeSidebar([note({ contents: "<img src=x onerror=alert(1)>" })], { itemTemplate })
      sidebar._refreshList()

      expect(sidebar.listContainer.querySelector("img")).toBeNull()
    })
  })

  describe("destroy", () => {
    it("can be torn down without throwing", () => {
      const { sidebar } = makeSidebar([highlight()])
      sidebar._refreshList()

      expect(() => sidebar.destroy()).not.toThrow()
    })
  })
})
