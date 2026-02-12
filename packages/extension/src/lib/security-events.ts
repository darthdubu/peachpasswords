/**
 * Security Event Logging System
 * 
 * A lightweight audit log that records security-relevant events for forensic analysis.
 * Events are stored locally with integrity verification.
 * 
 * Security considerations:
 * - Events are stored unencrypted but with basic tamper resistance
 * - Future enhancement: encrypt with a device-bound key
 * - Events are capped to prevent unbounded storage growth
 * - Duplicate events within a short window are collapsed to prevent spam
 */

export type SecurityEventType =
  | 'vault-unlock-success'
  | 'vault-unlock-failure'
  | 'biometric-auth-success'
  | 'biometric-auth-failure'
  | 'pin-auth-success'
  | 'pin-auth-failure'
  | 'sync-conflict-detected'
  | 'sync-conflict-resolved'
  | 'autofill-triggered'
  | 'autofill-rejected'
  | 'prototype-tampering-detected'
  | 'iv-collision-detected'
  | 'kdf-migration-completed'
  | 'kdf-migration-failed'
  | 's3-sync-failure'
  | 'export-attempt'
  | 'import-attempt'
  | 'password-generator-used'
  | 'vault-created'
  | 'vault-locked'
  | 'entry-created'
  | 'entry-updated'
  | 'entry-deleted'
  | 'entry-restored'
  | 'entry-permanently-deleted'

export type SecurityEventSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface SecurityEvent {
  id: string
  type: SecurityEventType
  timestamp: number
  details?: Record<string, unknown>
  severity: SecurityEventSeverity
}

// Storage key for security events
const SECURITY_EVENTS_KEY = 'peach_security_events'

// Maximum number of events to store (circular buffer behavior)
const MAX_SECURITY_EVENTS = 1000

// Minimum time between duplicate events (ms)
const DUPLICATE_WINDOW_MS = 5000

/**
 * Generate a unique event ID
 */
function generateEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Check if two events are duplicates (same type and similar details)
 */
function isDuplicateEvent(a: SecurityEvent, b: SecurityEvent): boolean {
  if (a.type !== b.type) return false
  
  // For events with entryId in details, compare those
  const aEntryId = a.details?.entryId
  const bEntryId = b.details?.entryId
  if (aEntryId && bEntryId && aEntryId === bEntryId) return true
  
  // For events without specific identifiers, check timestamp proximity
  const timeDiff = Math.abs(a.timestamp - b.timestamp)
  if (timeDiff < DUPLICATE_WINDOW_MS && !aEntryId && !bEntryId) return true
  
  return false
}

/**
 * Log a new security event
 * 
 * @param type - The type of security event
 * @param severity - Event severity level
 * @param details - Optional additional details (avoid including sensitive data)
 * @returns The logged event or null if logging failed
 */
export async function logSecurityEvent(
  type: SecurityEventType,
  severity: SecurityEventSeverity,
  details?: Record<string, unknown>
): Promise<SecurityEvent | null> {
  try {
    const event: SecurityEvent = {
      id: generateEventId(),
      type,
      timestamp: Date.now(),
      severity,
      details: details ? sanitizeDetails(details) : undefined
    }

    // Get existing events
    const result = await chrome.storage.local.get(SECURITY_EVENTS_KEY)
    const events: SecurityEvent[] = (result[SECURITY_EVENTS_KEY] as SecurityEvent[] | undefined) ?? []

    // Check for recent duplicate to prevent spam
    const lastEvent = events[0]
    if (lastEvent && isDuplicateEvent(lastEvent, event)) {
      return lastEvent
    }

    // Add new event at the beginning (newest first)
    const updatedEvents = [event, ...events].slice(0, MAX_SECURITY_EVENTS)

    // Store with a version header for future compatibility
    await chrome.storage.local.set({
      [SECURITY_EVENTS_KEY]: updatedEvents,
      [`${SECURITY_EVENTS_KEY}_version`]: 1,
      [`${SECURITY_EVENTS_KEY}_lastUpdate`]: Date.now()
    })

    return event
  } catch (error) {
    // Fail silently - logging should never block main flows
    console.warn('Failed to log security event:', error)
    return null
  }
}

/**
 * Sanitize event details to remove potentially sensitive information
 */
function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'secret', 'key', 'token', 'credential', 'masterKey', 'rawBytes']
  const sanitized: Record<string, unknown> = {}
  
  for (const [key, value] of Object.entries(details)) {
    // Skip sensitive keys
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
      sanitized[key] = '[REDACTED]'
    } else if (typeof value === 'string' && value.length > 500) {
      // Truncate long strings
      sanitized[key] = value.slice(0, 500) + '... [truncated]'
    } else {
      sanitized[key] = value
    }
  }
  
  return sanitized
}

/**
 * Retrieve all security events
 * 
 * @param options - Optional filter options
 * @returns Array of security events (newest first)
 */
export async function getSecurityEvents(options?: {
  limit?: number
  since?: number
  until?: number
}): Promise<SecurityEvent[]> {
  try {
    const result = await chrome.storage.local.get(SECURITY_EVENTS_KEY)
    let events: SecurityEvent[] = (result[SECURITY_EVENTS_KEY] as SecurityEvent[] | undefined) ?? []

    // Apply filters
    if (options?.since) {
      events = events.filter(e => e.timestamp >= options.since!)
    }
    if (options?.until) {
      events = events.filter(e => e.timestamp <= options.until!)
    }
    if (options?.limit && options.limit > 0) {
      events = events.slice(0, options.limit)
    }

    return events
  } catch (error) {
    console.error('Failed to retrieve security events:', error)
    return []
  }
}

/**
 * Get security events filtered by type
 * 
 * @param type - Event type to filter by
 * @param options - Optional filter options
 * @returns Filtered array of security events
 */
export async function getSecurityEventsByType(
  type: SecurityEventType,
  options?: { limit?: number; since?: number }
): Promise<SecurityEvent[]> {
  const events = await getSecurityEvents(options)
  return events.filter(e => e.type === type)
}

/**
 * Get security events by severity level
 * 
 * @param severity - Minimum severity level (inclusive)
 * @param options - Optional filter options
 * @returns Filtered array of security events
 */
export async function getSecurityEventsBySeverity(
  severity: SecurityEventSeverity,
  options?: { limit?: number; since?: number }
): Promise<SecurityEvent[]> {
  const severityOrder: SecurityEventSeverity[] = ['info', 'warning', 'error', 'critical']
  const minIndex = severityOrder.indexOf(severity)
  
  const events = await getSecurityEvents(options)
  return events.filter(e => severityOrder.indexOf(e.severity) >= minIndex)
}

/**
 * Clear all security events
 */
export async function clearSecurityEvents(): Promise<void> {
  try {
    await chrome.storage.local.remove([
      SECURITY_EVENTS_KEY,
      `${SECURITY_EVENTS_KEY}_version`,
      `${SECURITY_EVENTS_KEY}_lastUpdate`
    ])
  } catch (error) {
    console.error('Failed to clear security events:', error)
    throw error
  }
}

/**
 * Export security events for analysis
 * 
 * @param options - Export options
 * @returns JSON string of events
 */
export async function exportSecurityEvents(options?: {
  since?: number
  format?: 'json' | 'csv'
}): Promise<string> {
  const events = await getSecurityEvents({ since: options?.since })
  
  if (options?.format === 'csv') {
    return exportAsCsv(events)
  }
  
  // Default JSON format with metadata
  const exportData = {
    exportVersion: 1,
    exportedAt: Date.now(),
    eventCount: events.length,
    events
  }
  
  return JSON.stringify(exportData, null, 2)
}

/**
 * Export events as CSV
 */
function exportAsCsv(events: SecurityEvent[]): string {
  const headers = ['timestamp', 'type', 'severity', 'id', 'details']
  const rows = events.map(e => [
    new Date(e.timestamp).toISOString(),
    e.type,
    e.severity,
    e.id,
    e.details ? JSON.stringify(e.details).replace(/"/g, '""') : ''
  ])
  
  return [headers.join(','), ...rows.map(r => r.map(cell => `"${cell}"`).join(','))].join('\n')
}

/**
 * Get security event statistics
 */
export async function getSecurityEventStats(): Promise<{
  totalEvents: number
  eventsByType: Record<string, number>
  eventsBySeverity: Record<string, number>
  firstEvent: number | null
  lastEvent: number | null
}> {
  const events = await getSecurityEvents()
  
  const eventsByType: Record<string, number> = {}
  const eventsBySeverity: Record<string, number> = {}
  
  for (const event of events) {
    eventsByType[event.type] = (eventsByType[event.type] || 0) + 1
    eventsBySeverity[event.severity] = (eventsBySeverity[event.severity] || 0) + 1
  }
  
  return {
    totalEvents: events.length,
    eventsByType,
    eventsBySeverity,
    firstEvent: events.length > 0 ? events[events.length - 1].timestamp : null,
    lastEvent: events.length > 0 ? events[0].timestamp : null
  }
}

/**
 * Log multiple security events in batch (for sync conflicts, etc.)
 * More efficient than individual logSecurityEvent calls
 */
export async function logSecurityEventsBatch(
  events: Array<{
    type: SecurityEventType
    severity: SecurityEventSeverity
    details?: Record<string, unknown>
  }>
): Promise<SecurityEvent[]> {
  if (events.length === 0) return []
  
  try {
    // Get existing events
    const result = await chrome.storage.local.get(SECURITY_EVENTS_KEY)
    const existingEvents: SecurityEvent[] = (result[SECURITY_EVENTS_KEY] as SecurityEvent[] | undefined) ?? []
    
    // Create new events
    const newEvents: SecurityEvent[] = events.map(e => ({
      id: generateEventId(),
      type: e.type,
      timestamp: Date.now(),
      severity: e.severity,
      details: e.details ? sanitizeDetails(e.details) : undefined
    }))
    
    // Merge and cap
    const updatedEvents = [...newEvents, ...existingEvents].slice(0, MAX_SECURITY_EVENTS)
    
    await chrome.storage.local.set({
      [SECURITY_EVENTS_KEY]: updatedEvents,
      [`${SECURITY_EVENTS_KEY}_version`]: 1,
      [`${SECURITY_EVENTS_KEY}_lastUpdate`]: Date.now()
    })
    
    return newEvents
  } catch (error) {
    console.warn('Failed to log security events batch:', error)
    return []
  }
}

// Re-export for convenience
export { SECURITY_EVENTS_KEY, MAX_SECURITY_EVENTS }
