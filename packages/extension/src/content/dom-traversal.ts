export interface DOMElement {
  element: Element
  root: Document | ShadowRoot
  path: string[]
}

export interface FoundInput extends DOMElement {
  element: HTMLInputElement
}

export function querySelectorAllDeep(
  selector: string,
  root: Document | ShadowRoot = document
): Element[] {
  const results: Element[] = []

  results.push(...Array.from(root.querySelectorAll(selector)))

  const elementsWithShadow = root.querySelectorAll('*')
  for (const element of elementsWithShadow) {
    if (element.shadowRoot) {
      results.push(...querySelectorAllDeep(selector, element.shadowRoot))
    }
  }

  return results
}

export function querySelectorDeep(
  selector: string,
  root: Document | ShadowRoot = document
): Element | null {
  const result = root.querySelector(selector)
  if (result) return result

  const elementsWithShadow = root.querySelectorAll('*')
  for (const element of elementsWithShadow) {
    if (element.shadowRoot) {
      const shadowResult = querySelectorDeep(selector, element.shadowRoot)
      if (shadowResult) return shadowResult
    }
  }

  return null
}

export function findAllInputFields(root: Document | ShadowRoot = document): FoundInput[] {
  const inputs: FoundInput[] = []
  const selector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"])'

  const elements = querySelectorAllDeep(selector, root)

  for (const element of elements) {
    if (element instanceof HTMLInputElement && isVisible(element)) {
      inputs.push({
        element,
        root,
        path: buildElementPath(element, root)
      })
    }
  }

  return inputs
}

export function findAllForms(root: Document | ShadowRoot = document): HTMLFormElement[] {
  const forms: HTMLFormElement[] = []
  const elements = querySelectorAllDeep('form', root)

  for (const element of elements) {
    if (element instanceof HTMLFormElement && isVisible(element)) {
      forms.push(element)
    }
  }

  return forms
}

export function buildElementPath(element: Element, stopRoot: Document | ShadowRoot): string[] {
  const path: string[] = []
  let current: Element | null = element

  while (current) {
    if ((stopRoot as unknown) === current) break
    let identifier = current.tagName.toLowerCase()

    if (current.id) {
      identifier += `#${current.id}`
    } else if (current.className && typeof current.className === 'string') {
      const classes = current.className.split(' ').filter(c => c).slice(0, 2)
      if (classes.length > 0) {
        identifier += `.${classes.join('.')}`
      }
    }

    if (current instanceof HTMLInputElement && current.name) {
      identifier += `[name="${current.name}"]`
    }

    path.unshift(identifier)
    current = current.parentElement

    if (current?.shadowRoot) {
      const host = findShadowHost(current, stopRoot)
      if (host) {
        path.unshift(`shadow:${host.tagName.toLowerCase()}`)
        current = host.parentElement
      }
    }
  }

  return path
}

function findShadowHost(_element: Element, root: Document | ShadowRoot): Element | null {
  if (root instanceof ShadowRoot) {
    return root.host
  }
  return null
}

export function isVisible(element: Element): boolean {
  const style = window.getComputedStyle(element)

  if (style.display === 'none') return false
  if (style.visibility === 'hidden') return false
  if (parseFloat(style.opacity) === 0) return false

  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false

  return true
}

export function getElementFromPath(path: string[], root: Document | ShadowRoot = document): Element | null {
  let current: Document | ShadowRoot | Element = root

  for (const segment of path) {
    if (segment.startsWith('shadow:')) {
      const hostElement: Element | null = current instanceof ShadowRoot ? current.host : null
      if (!hostElement || !hostElement.shadowRoot) return null
      current = hostElement.shadowRoot
    } else {
      const selector = segment.replace(/\[name="([^"]+)"\]/, '[name="$1"]')
      if (current instanceof Document || current instanceof ShadowRoot) {
        const matchedElement: Element | null = current.querySelector(selector)
        if (!matchedElement) return null
        current = matchedElement
      } else {
        return null
      }
    }
  }

  return current instanceof Element ? current : null
}

export function getIFrames(root: Document = document): HTMLIFrameElement[] {
  return Array.from(root.querySelectorAll('iframe')).filter(iframe => {
    try {
      const doc = iframe.contentDocument
      return doc !== null
    } catch {
      return false
    }
  })
}

export function traverseIFrames(callback: (doc: Document, iframe: HTMLIFrameElement | null) => void): void {
  callback(document, null)

  const iframes = getIFrames(document)
  for (const iframe of iframes) {
    try {
      const doc = iframe.contentDocument
      if (doc) {
        callback(doc, iframe)
      }
    } catch {
      return
    }
  }
}

export function findInputInAllContexts(
  predicate: (input: HTMLInputElement) => boolean
): HTMLInputElement | null {
  let found: HTMLInputElement | null = null

  traverseIFrames((doc) => {
    if (found) return

    const inputs = doc.querySelectorAll('input')
    for (const input of inputs) {
      if (predicate(input)) {
        found = input
        return
      }
    }

    const shadowInputs = findAllInputFields(doc)
    for (const foundInput of shadowInputs) {
      if (predicate(foundInput.element)) {
        found = foundInput.element
        return
      }
    }
  })

  return found
}

export function getFormData(form: HTMLFormElement): Record<string, string> {
  const data: Record<string, string> = {}
  const formData = new FormData(form)

  formData.forEach((value, key) => {
    if (typeof value === 'string') {
      data[key] = value
    }
  })

  return data
}

export function watchForMutations(
  callback: (mutations: MutationRecord[]) => void,
  options: MutationObserverInit = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['type', 'name', 'id', 'autocomplete']
  }
): MutationObserver {
  const observer = new MutationObserver(callback)
  observer.observe(document.body, options)
  return observer
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}
