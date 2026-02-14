export interface TOTPQrData {
  secret: string
  issuer?: string
  account?: string
  algorithm?: string
  digits?: number
  period?: number
}

export class TOTPQrDetector {
  private observer: MutationObserver | null = null
  private scannedImages = new WeakSet<HTMLImageElement>()
  private isScanning = false

  start(): void {
    if (this.isScanning) return
    this.isScanning = true

    this.scanPageForQRCodes()

    this.observer = new MutationObserver((mutations) => {
      let shouldScan = false
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLImageElement) {
            shouldScan = true
            break
          }
          if (node instanceof HTMLElement && node.querySelector('img')) {
            shouldScan = true
            break
          }
        }
        if (shouldScan) break
      }
      if (shouldScan) {
        this.debouncedScan()
      }
    })

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    })
  }

  stop(): void {
    this.isScanning = false
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
  }

  private debounceTimer: number | null = null
  private debouncedScan(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = window.setTimeout(() => {
      this.scanPageForQRCodes()
    }, 500)
  }

  private async scanPageForQRCodes(): Promise<void> {
    if (!this.isScanning) return

    const images = document.querySelectorAll('img')

    for (const img of images) {
      if (this.scannedImages.has(img)) continue
      if (!this.isPotentialQRCode(img)) continue

      this.scannedImages.add(img)

      try {
        const qrData = await this.scanImageForQR(img)
        if (qrData) {
          const totpData = this.parseTOTPUri(qrData)
          if (totpData) {
            this.handleTOTPDetected(totpData)
          }
        }
      } catch {
        // Silently fail
      }
    }

    const canvases = document.querySelectorAll('canvas')
    for (const canvas of canvases) {
      if (this.scannedImages.has(canvas as unknown as HTMLImageElement)) continue
      this.scannedImages.add(canvas as unknown as HTMLImageElement)

      try {
        const qrData = await this.scanCanvasForQR(canvas)
        if (qrData) {
          const totpData = this.parseTOTPUri(qrData)
          if (totpData) {
            this.handleTOTPDetected(totpData)
          }
        }
      } catch {
        // Silently fail
      }
    }
  }

  private isPotentialQRCode(img: HTMLImageElement): boolean {
    const width = img.naturalWidth || img.width
    const height = img.naturalHeight || img.height

    if (width < 100 || height < 100) return false
    if (width > 1000 || height > 1000) return false

    const aspectRatio = width / height
    if (aspectRatio < 0.8 || aspectRatio > 1.2) return false

    const rect = img.getBoundingClientRect()
    if (rect.width < 50 || rect.height < 50) return false

    const style = window.getComputedStyle(img)
    if (style.display === 'none' || style.visibility === 'hidden') return false

    return true
  }

  private async scanImageForQR(img: HTMLImageElement): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not get canvas context'))
        return
      }

      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height

      const tempImg = new Image()
      tempImg.crossOrigin = 'anonymous'

      tempImg.onload = () => {
        try {
          ctx.drawImage(tempImg, 0, 0)
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const qrData = this.decodeQRFromImageData(imageData)
          resolve(qrData)
        } catch (error) {
          reject(error)
        }
      }

      tempImg.onerror = () => {
        try {
          ctx.drawImage(img, 0, 0)
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const qrData = this.decodeQRFromImageData(imageData)
          resolve(qrData)
        } catch (error) {
          reject(error)
        }
      }

      tempImg.src = img.src
    })
  }

  private async scanCanvasForQR(canvas: HTMLCanvasElement): Promise<string | null> {
    try {
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      return this.decodeQRFromImageData(imageData)
    } catch {
      return null
    }
  }

  private decodeQRFromImageData(imageData: ImageData): string | null {
    const grayData = this.toGrayscale(imageData)
    return this.attemptQRDecode(grayData, imageData.width, imageData.height)
  }

  private toGrayscale(imageData: ImageData): Uint8Array {
    const gray = new Uint8Array(imageData.width * imageData.height)
    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = imageData.data[i]
      const g = imageData.data[i + 1]
      const b = imageData.data[i + 2]
      gray[i / 4] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    }
    return gray
  }

  private attemptQRDecode(grayData: Uint8Array, width: number, height: number): string | null {
    const finderPatterns = this.findFinderPatterns(grayData, width, height)

    if (finderPatterns.length >= 3) {
      return this.attemptDecodeWithPatterns(grayData, width, height, finderPatterns)
    }

    return null
  }

  private findFinderPatterns(grayData: Uint8Array, width: number, height: number): Array<{x: number, y: number}> {
    const patterns: Array<{x: number, y: number}> = []
    const threshold = 128
    const step = Math.max(1, Math.floor(Math.min(width, height) / 100))

    for (let y = step * 3; y < height - step * 3; y += step) {
      for (let x = step * 3; x < width - step * 3; x += step) {
        if (this.isFinderPatternAt(grayData, x, y, width, height, threshold)) {
          patterns.push({ x, y })
          if (patterns.length >= 3) return patterns
        }
      }
    }

    return patterns
  }

  private isFinderPatternAt(
    grayData: Uint8Array,
    cx: number,
    cy: number,
    width: number,
    height: number,
    threshold: number
  ): boolean {
    const size = Math.min(width, height) / 7
    if (size < 3) return false

    const samples = [
      { x: cx, y: cy, expectedDark: true },
      { x: cx - size, y: cy, expectedDark: false },
      { x: cx + size, y: cy, expectedDark: false },
      { x: cx, y: cy - size, expectedDark: false },
      { x: cx, y: cy + size, expectedDark: false },
    ]

    let matches = 0
    for (const sample of samples) {
      if (sample.x < 0 || sample.x >= width || sample.y < 0 || sample.y >= height) {
        continue
      }
      const idx = Math.floor(sample.y) * width + Math.floor(sample.x)
      const isDark = grayData[idx] < threshold
      if (isDark === sample.expectedDark) {
        matches++
      }
    }

    return matches >= 3
  }

  private attemptDecodeWithPatterns(
    _grayData: Uint8Array,
    _width: number,
    _height: number,
    _patterns: Array<{x: number, y: number}>
  ): string | null {
    return null
  }

  parseTOTPUri(uri: string): TOTPQrData | null {
    if (!uri.startsWith('otpauth://')) {
      return null
    }

    try {
      const url = new URL(uri)
      const params = url.searchParams

      const pathParts = url.pathname.split('/')
      const type = pathParts[1]
      const label = decodeURIComponent(pathParts[2] || '')

      let issuer = params.get('issuer') || ''
      let account = label

      if (label.includes(':')) {
        const [iss, acc] = label.split(':', 2)
        if (!issuer) issuer = iss
        account = acc
      }

      const secret = params.get('secret')
      if (!secret) {
        return null
      }

      return {
        secret,
        issuer: issuer || undefined,
        account: account || undefined,
        algorithm: params.get('algorithm') || 'SHA1',
        digits: parseInt(params.get('digits') || '6', 10),
        period: type === 'totp' ? parseInt(params.get('period') || '30', 10) : undefined
      }
    } catch {
      return null
    }
  }

  private handleTOTPDetected(data: TOTPQrData): void {
    chrome.runtime.sendMessage({
      type: 'TOTP_QR_DETECTED',
      data: {
        ...data,
        url: window.location.href,
        domain: window.location.hostname
      }
    }).catch(() => {
      // Extension context might not be available
    })
  }
}

export const totpQrDetector = new TOTPQrDetector()
