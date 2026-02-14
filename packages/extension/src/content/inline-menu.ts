import { AUTOFILL_STYLES } from './autofill-styles'

export interface InlineMenuEntry {
  entryId: string
  name: string
  username: string
  domain?: string
}

export interface InlineMenuOptions {
  entries: InlineMenuEntry[]
  onSelect: (entry: InlineMenuEntry) => void
  onManage: () => void
  onClose: () => void
}

export class InlineMenu {
  private container: HTMLElement | null = null
  private shadowRoot: ShadowRoot | null = null
  private options: InlineMenuOptions
  private selectedIndex = 0
  private keyboardHandler: ((e: KeyboardEvent) => void) | null = null
  private clickOutsideHandler: ((e: MouseEvent) => void) | null = null

  constructor(options: InlineMenuOptions) {
    this.options = options
  }

  show(anchorElement: HTMLElement): void {
    this.hide()

    const rect = anchorElement.getBoundingClientRect()
    this.createContainer()

    if (!this.container || !this.shadowRoot) return

    const menu = this.renderMenu()
    this.shadowRoot.appendChild(menu)

    const menuRect = menu.getBoundingClientRect()
    let top = rect.bottom + 8
    let left = rect.left

    if (left + menuRect.width > window.innerWidth) {
      left = window.innerWidth - menuRect.width - 16
    }
    if (top + menuRect.height > window.innerHeight) {
      top = rect.top - menuRect.height - 8
    }

    menu.style.top = `${top}px`
    menu.style.left = `${left}px`

    this.setupKeyboardNavigation(menu)
    this.setupClickOutside(menu)

    const firstRow = menu.querySelector('.peach-credential-row') as HTMLElement
    if (firstRow) {
      firstRow.focus()
    }
  }

  hide(): void {
    if (this.container) {
      this.cleanup()
      if (this.container.parentElement) {
        this.container.parentElement.removeChild(this.container)
      }
      this.container = null
      this.shadowRoot = null
    }
  }

  private createContainer(): void {
    this.container = document.createElement('div')
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2147483646;
    `
    this.shadowRoot = this.container.attachShadow({ mode: 'closed' })

    const style = document.createElement('style')
    style.textContent = AUTOFILL_STYLES + this.getInlineStyles()
    this.shadowRoot.appendChild(style)

    document.body.appendChild(this.container)
  }

  private renderMenu(): HTMLElement {
    const menu = document.createElement('div')
    menu.className = 'peach-dropdown peach-inline-menu'
    menu.style.pointerEvents = 'auto'

    const header = document.createElement('div')
    header.className = 'peach-dropdown-header'
    header.innerHTML = `
      <div class="peach-logo">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
      </div>
      <span class="peach-brand">Peach Passwords</span>
    `
    menu.appendChild(header)

    const body = document.createElement('div')
    body.className = 'peach-dropdown-body'

    if (this.options.entries.length === 0) {
      body.innerHTML = `
        <div class="peach-empty-state">
          No credentials found for this site
        </div>
      `
    } else {
      this.options.entries.forEach((entry, index) => {
        const row = this.createEntryRow(entry, index)
        body.appendChild(row)
      })
    }

    menu.appendChild(body)

    const footer = document.createElement('div')
    footer.className = 'peach-dropdown-footer'
    footer.innerHTML = `
      <button class="peach-btn" data-action="manage">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"/>
        </svg>
        Manage
      </button>
      <button class="peach-btn peach-btn-primary" data-action="close">
        Close
      </button>
    `

    footer.querySelector('[data-action="manage"]')?.addEventListener('click', () => {
      this.options.onManage()
      this.hide()
    })

    footer.querySelector('[data-action="close"]')?.addEventListener('click', () => {
      this.options.onClose()
      this.hide()
    })

    menu.appendChild(footer)

    return menu
  }

  private createEntryRow(entry: InlineMenuEntry, index: number): HTMLElement {
    const row = document.createElement('div')
    row.className = 'peach-credential-row'
    row.tabIndex = 0
    row.dataset.index = String(index)

    const initial = entry.name.charAt(0).toUpperCase()

    row.innerHTML = `
      <div class="peach-favicon">
        <div class="peach-favicon-fallback">${initial}</div>
      </div>
      <div class="peach-credential-info">
        <div class="peach-credential-name">${this.escapeHtml(entry.name)}</div>
        <div class="peach-credential-username">${this.escapeHtml(entry.username)}</div>
      </div>
      <svg class="peach-credential-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18l6-6-6-6"/>
      </svg>
    `

    row.addEventListener('click', () => {
      this.options.onSelect(entry)
      this.hide()
    })

    row.addEventListener('mouseenter', () => {
      this.selectedIndex = index
      row.focus()
    })

    return row
  }

  private setupKeyboardNavigation(menu: HTMLElement): void {
    const rows = menu.querySelectorAll('.peach-credential-row')

    this.keyboardHandler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          this.selectedIndex = Math.min(this.selectedIndex + 1, rows.length - 1)
          ;(rows[this.selectedIndex] as HTMLElement)?.focus()
          break
        case 'ArrowUp':
          e.preventDefault()
          this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
          ;(rows[this.selectedIndex] as HTMLElement)?.focus()
          break
        case 'Enter':
          e.preventDefault()
          if (rows[this.selectedIndex]) {
            const entry = this.options.entries[this.selectedIndex]
            if (entry) {
              this.options.onSelect(entry)
              this.hide()
            }
          }
          break
        case 'Escape':
          e.preventDefault()
          this.options.onClose()
          this.hide()
          break
      }
    }

    document.addEventListener('keydown', this.keyboardHandler)
  }

  private setupClickOutside(menu: HTMLElement): void {
    this.clickOutsideHandler = (e: MouseEvent) => {
      const target = e.target as Node
      if (!menu.contains(target)) {
        this.options.onClose()
        this.hide()
      }
    }

    setTimeout(() => {
      document.addEventListener('click', this.clickOutsideHandler!)
    }, 0)
  }

  private cleanup(): void {
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler)
      this.keyboardHandler = null
    }
    if (this.clickOutsideHandler) {
      document.removeEventListener('click', this.clickOutsideHandler)
      this.clickOutsideHandler = null
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  private getInlineStyles(): string {
    return `
      .peach-inline-menu {
        position: fixed !important;
        animation: peach-menu-appear 150ms ease-out;
      }

      @keyframes peach-menu-appear {
        from {
          opacity: 0;
          transform: translateY(-4px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      .peach-credential-row {
        outline: none;
      }

      .peach-credential-row:focus {
        background: var(--peach-hover);
        box-shadow: inset 0 0 0 2px rgba(255, 154, 108, 0.3);
      }
    `
  }
}
