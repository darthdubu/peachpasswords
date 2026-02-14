import { AUTOFILL_STYLES } from './autofill-styles'

export interface SavePasswordData {
  username: string
  password: string
  url: string
  title?: string
}

export interface SavePasswordOptions {
  data: SavePasswordData
  onSave: (data: SavePasswordData, name: string) => void
  onUpdate: (data: SavePasswordData) => void
  onDismiss: () => void
  onNever: () => void
  existingEntry?: {
    name: string
    entryId: string
  }
}

export class SavePasswordNotification {
  private container: HTMLElement | null = null
  private shadowRoot: ShadowRoot | null = null
  private options: SavePasswordOptions
  private autoDismissTimer: ReturnType<typeof setTimeout> | null = null
  private readonly AUTO_DISMISS_DELAY = 15000

  constructor(options: SavePasswordOptions) {
    this.options = options
  }

  show(): void {
    this.hide()
    this.createContainer()

    if (!this.container || !this.shadowRoot) return

    const notification = this.renderNotification()
    this.shadowRoot.appendChild(notification)

    this.startAutoDismiss()
  }

  hide(): void {
    if (this.autoDismissTimer) {
      clearTimeout(this.autoDismissTimer)
      this.autoDismissTimer = null
    }

    if (this.container) {
      const notification = this.shadowRoot?.querySelector('.peach-notification')
      if (notification) {
        notification.classList.add('closing')
        setTimeout(() => {
          if (this.container?.parentElement) {
            this.container.parentElement.removeChild(this.container)
          }
          this.container = null
          this.shadowRoot = null
        }, 200)
      } else {
        if (this.container.parentElement) {
          this.container.parentElement.removeChild(this.container)
        }
        this.container = null
        this.shadowRoot = null
      }
    }
  }

  private createContainer(): void {
    this.container = document.createElement('div')
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      z-index: 2147483647;
      pointer-events: none;
    `
    this.shadowRoot = this.container.attachShadow({ mode: 'closed' })

    const style = document.createElement('style')
    style.textContent = AUTOFILL_STYLES + this.getNotificationStyles()
    this.shadowRoot.appendChild(style)

    document.body.appendChild(this.container)
  }

  private renderNotification(): HTMLElement {
    const notification = document.createElement('div')
    notification.className = 'peach-notification'
    notification.style.pointerEvents = 'auto'

    const isUpdate = !!this.options.existingEntry
    const title = isUpdate ? 'Update password?' : 'Save password?'
    const subtitle = isUpdate
      ? `Update saved password for ${this.options.existingEntry?.name || this.options.data.username}`
      : `Save password for ${this.options.data.username} on this site?`

    notification.innerHTML = `
      <div class="peach-notification-content">
        <div class="peach-notification-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
          </svg>
        </div>
        <div class="peach-notification-text">
          <div class="peach-notification-title">${title}</div>
          <div class="peach-notification-subtitle">${subtitle}</div>
        </div>
        <div class="peach-notification-actions">
          ${isUpdate ? `
            <button class="peach-notification-btn peach-notification-btn-secondary" data-action="never">
              Never
            </button>
          ` : ''}
          <button class="peach-notification-btn peach-notification-btn-secondary" data-action="dismiss">
            Not now
          </button>
          <button class="peach-notification-btn peach-notification-btn-primary" data-action="save">
            ${isUpdate ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
      <div class="peach-notification-progress"></div>
    `

    notification.querySelector('[data-action="save"]')?.addEventListener('click', () => {
      if (isUpdate) {
        this.options.onUpdate(this.options.data)
      } else {
        const name = prompt('Name for this password entry:', this.options.data.title || document.title) || 'Untitled'
        this.options.onSave(this.options.data, name)
      }
      this.hide()
    })

    notification.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => {
      this.options.onDismiss()
      this.hide()
    })

    notification.querySelector('[data-action="never"]')?.addEventListener('click', () => {
      this.options.onNever()
      this.hide()
    })

    return notification
  }

  private startAutoDismiss(): void {
    const progress = this.shadowRoot?.querySelector('.peach-notification-progress') as HTMLElement
    if (progress) {
      progress.style.animation = `peach-progress ${this.AUTO_DISMISS_DELAY}ms linear forwards`
    }

    this.autoDismissTimer = setTimeout(() => {
      this.options.onDismiss()
      this.hide()
    }, this.AUTO_DISMISS_DELAY)
  }

  private getNotificationStyles(): string {
    return `
      .peach-notification {
        background: var(--peach-bg);
        border-bottom: 1px solid var(--peach-border);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        animation: peach-notification-slide-down 300ms ease-out;
      }

      @keyframes peach-notification-slide-down {
        from {
          opacity: 0;
          transform: translateY(-100%);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .peach-notification.closing {
        animation: peach-notification-slide-up 200ms ease-out forwards;
      }

      @keyframes peach-notification-slide-up {
        from {
          opacity: 1;
          transform: translateY(0);
        }
        to {
          opacity: 0;
          transform: translateY(-100%);
        }
      }

      .peach-notification-content {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px 24px;
        max-width: 1200px;
        margin: 0 auto;
      }

      .peach-notification-icon {
        width: 40px;
        height: 40px;
        border-radius: var(--peach-radius);
        background: linear-gradient(135deg, rgba(255, 154, 108, 0.2), rgba(255, 107, 138, 0.2));
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--peach-accent);
      }

      .peach-notification-icon svg {
        width: 20px;
        height: 20px;
      }

      .peach-notification-text {
        flex: 1;
        min-width: 0;
      }

      .peach-notification-title {
        font-weight: 600;
        font-size: 14px;
        color: var(--peach-text);
        margin-bottom: 2px;
      }

      .peach-notification-subtitle {
        font-size: 13px;
        color: var(--peach-text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .peach-notification-actions {
        display: flex;
        gap: 8px;
        flex-shrink: 0;
      }

      .peach-notification-btn {
        padding: 8px 16px;
        border-radius: var(--peach-radius-sm);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 150ms ease;
        border: 1px solid var(--peach-border);
        background: rgba(255, 255, 255, 0.05);
        color: var(--peach-text-muted);
      }

      .peach-notification-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: var(--peach-text);
      }

      .peach-notification-btn-primary {
        background: linear-gradient(135deg, rgba(255, 154, 108, 0.2), rgba(255, 107, 138, 0.2));
        border-color: rgba(255, 154, 108, 0.3);
        color: var(--peach-accent);
      }

      .peach-notification-btn-primary:hover {
        background: linear-gradient(135deg, rgba(255, 154, 108, 0.3), rgba(255, 107, 138, 0.3));
      }

      .peach-notification-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 2px;
        background: linear-gradient(90deg, var(--peach-accent), var(--peach-accent-2));
        width: 100%;
        transform-origin: left;
      }

      @keyframes peach-progress {
        from {
          transform: scaleX(1);
        }
        to {
          transform: scaleX(0);
        }
      }
    `
  }
}
