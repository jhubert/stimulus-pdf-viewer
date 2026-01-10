import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["container", "toggle"]

  connect() {
    this.isSyncing = false
  }

  sync(event) {
    if (this.isSyncing) return
    if (!this.toggleTarget.checked) return

    const master = event.currentTarget
    const slave = this.containerTargets.find(target => target !== master)

    if (!slave) return

    this.isSyncing = true

    // Calculate percentage-based scroll to account for potential
    // differences in zoom levels or page counts
    const scrollPercentageY = master.scrollTop / (master.scrollHeight - master.clientHeight)
    const scrollPercentageX = master.scrollLeft / (master.scrollWidth - master.clientWidth)

    window.requestAnimationFrame(() => {
      slave.scrollTop = scrollPercentageY * (slave.scrollHeight - slave.clientHeight)
      slave.scrollLeft = scrollPercentageX * (slave.scrollWidth - slave.clientWidth)

      // Reset the lock after the browser paint
      window.requestAnimationFrame(() => {
        this.isSyncing = false
      })
    })
  }
}
