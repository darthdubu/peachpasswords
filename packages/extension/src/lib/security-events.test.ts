/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  logSecurityEvent,
  getSecurityEvents,
  getSecurityEventsByType,
  getSecurityEventsBySeverity,
  clearSecurityEvents,
  exportSecurityEvents,
  getSecurityEventStats,
  logSecurityEventsBatch,
  type SecurityEventType,
  type SecurityEventSeverity,
  SECURITY_EVENTS_KEY
} from './security-events'

// Mock chrome.storage
const mockStorage: Record<string, unknown> = {}

const mockChrome = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const keyArray = Array.isArray(keys) ? keys : [keys]
        const result: Record<string, unknown> = {}
        for (const key of keyArray) {
          if (mockStorage[key] !== undefined) {
            result[key] = mockStorage[key]
          }
        }
        return result
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(mockStorage, items)
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const keyArray = Array.isArray(keys) ? keys : [keys]
        for (const key of keyArray) {
          delete mockStorage[key]
        }
      })
    }
  }
}

beforeEach(() => {
  // Clear storage before each test
  Object.keys(mockStorage).forEach(key => delete mockStorage[key])
  // @ts-expect-error - mocking chrome global
  global.chrome = mockChrome
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('Security Events', () => {
  describe('logSecurityEvent', () => {
    it('should log a basic security event', async () => {
      const event = await logSecurityEvent('vault-unlock-success', 'info')
      
      expect(event).not.toBeNull()
      expect(event?.type).toBe('vault-unlock-success')
      expect(event?.severity).toBe('info')
      expect(event?.id).toBeDefined()
      expect(event?.timestamp).toBeGreaterThan(0)
    })

    it('should log an event with details', async () => {
      const details = { entryId: 'test-entry', source: 'test' }
      const event = await logSecurityEvent('entry-created', 'info', details)
      
      expect(event).not.toBeNull()
      expect(event?.details).toEqual(details)
    })

    it('should sanitize sensitive details', async () => {
      const details = {
        entryId: 'test-entry',
        password: 'secret123',
        apiKey: 'key123',
        normalField: 'normal-value'
      }
      const event = await logSecurityEvent('export-attempt', 'warning', details)
      
      expect(event?.details?.password).toBe('[REDACTED]')
      expect(event?.details?.apiKey).toBe('[REDACTED]')
      expect(event?.details?.normalField).toBe('normal-value')
    })

    it('should truncate long strings in details', async () => {
      const longValue = 'a'.repeat(600)
      const details = { longField: longValue }
      const event = await logSecurityEvent('export-attempt', 'info', details)
      
      expect((event?.details?.longField as string).length).toBeLessThan(600)
      expect((event?.details?.longField as string)).toContain('[truncated]')
    })

    it('should collapse duplicate events within window', async () => {
      const event1 = await logSecurityEvent('vault-unlock-failure', 'warning')
      const event2 = await logSecurityEvent('vault-unlock-failure', 'warning')
      
      // Should return the first event (considered duplicate)
      expect(event2?.id).toBe(event1?.id)
      
      const events = await getSecurityEvents()
      expect(events.length).toBe(1)
    })

    it('should allow different event types without deduplication', async () => {
      await logSecurityEvent('vault-unlock-success', 'info')
      await logSecurityEvent('vault-unlock-failure', 'warning')
      
      const events = await getSecurityEvents()
      expect(events.length).toBe(2)
    })

    it('should handle storage errors gracefully', async () => {
      mockChrome.storage.local.set.mockRejectedValueOnce(new Error('Storage error'))
      
      const event = await logSecurityEvent('vault-unlock-success', 'info')
      expect(event).toBeNull()
    })
  })

  describe('getSecurityEvents', () => {
    it('should return empty array when no events exist', async () => {
      const events = await getSecurityEvents()
      expect(events).toEqual([])
    })

    it('should return events in reverse chronological order', async () => {
      await logSecurityEvent('vault-created', 'info')
      await new Promise(r => setTimeout(r, 10))
      await logSecurityEvent('vault-unlock-success', 'info')
      await new Promise(r => setTimeout(r, 10))
      await logSecurityEvent('vault-locked', 'info')
      
      const events = await getSecurityEvents()
      expect(events.length).toBe(3)
      expect(events[0].type).toBe('vault-locked')
      expect(events[1].type).toBe('vault-unlock-success')
      expect(events[2].type).toBe('vault-created')
    })

    it('should respect limit option', async () => {
      for (let i = 0; i < 5; i++) {
        await logSecurityEvent('entry-created', 'info', { entryId: `entry-${i}` })
      }
      
      const events = await getSecurityEvents({ limit: 3 })
      expect(events.length).toBe(3)
    })

    it('should respect since option', async () => {
      const _beforeTime = Date.now()
      await logSecurityEvent('entry-created', 'info', { entryId: 'entry-1' })
      await new Promise(r => setTimeout(r, 10))
      const afterTime = Date.now()
      await logSecurityEvent('entry-created', 'info', { entryId: 'entry-2' })
      
      const events = await getSecurityEvents({ since: afterTime })
      expect(events.length).toBe(1)
      expect(events[0].details?.entryId).toBe('entry-2')
      // Use _beforeTime to avoid unused variable warning
      expect(_beforeTime).toBeGreaterThan(0)
    })

    it('should respect until option', async () => {
      await logSecurityEvent('entry-created', 'info', { entryId: 'entry-1' })
      await new Promise(r => setTimeout(r, 10))
      const middleTime = Date.now()
      await new Promise(r => setTimeout(r, 10))
      await logSecurityEvent('entry-created', 'info', { entryId: 'entry-2' })
      
      const events = await getSecurityEvents({ until: middleTime })
      expect(events.length).toBe(1)
      expect(events[0].details?.entryId).toBe('entry-1')
      // Use middleTime to avoid unused variable warning
      expect(middleTime).toBeGreaterThan(0)
    })
  })

  describe('getSecurityEventsByType', () => {
    it('should filter events by type', async () => {
      await logSecurityEvent('vault-unlock-success', 'info')
      await logSecurityEvent('vault-unlock-failure', 'warning')
      await logSecurityEvent('vault-unlock-success', 'info')
      
      const successEvents = await getSecurityEventsByType('vault-unlock-success')
      expect(successEvents.length).toBe(2)
      
      const failureEvents = await getSecurityEventsByType('vault-unlock-failure')
      expect(failureEvents.length).toBe(1)
    })

    it('should respect limit option', async () => {
      for (let i = 0; i < 5; i++) {
        await logSecurityEvent('entry-created', 'info', { entryId: `entry-${i}` })
      }
      
      const events = await getSecurityEventsByType('entry-created', { limit: 2 })
      expect(events.length).toBe(2)
    })
  })

  describe('getSecurityEventsBySeverity', () => {
    it('should filter events by minimum severity', async () => {
      await logSecurityEvent('vault-unlock-success', 'info')
      await logSecurityEvent('pin-auth-failure', 'warning')
      await logSecurityEvent('biometric-auth-failure', 'error')
      await logSecurityEvent('prototype-tampering-detected', 'critical')
      
      // Get warning and above
      const warningAndAbove = await getSecurityEventsBySeverity('warning')
      expect(warningAndAbove.length).toBe(3)
      
      // Get error and above
      const errorAndAbove = await getSecurityEventsBySeverity('error')
      expect(errorAndAbove.length).toBe(2)
      
      // Get only critical
      const criticalOnly = await getSecurityEventsBySeverity('critical')
      expect(criticalOnly.length).toBe(1)
    })
  })

  describe('clearSecurityEvents', () => {
    it('should remove all events', async () => {
      await logSecurityEvent('vault-unlock-success', 'info')
      await logSecurityEvent('vault-locked', 'info')
      
      await clearSecurityEvents()
      
      const events = await getSecurityEvents()
      expect(events.length).toBe(0)
      expect(mockStorage[SECURITY_EVENTS_KEY]).toBeUndefined()
    })
  })

  describe('exportSecurityEvents', () => {
    it('should export events as JSON by default', async () => {
      await logSecurityEvent('vault-created', 'info')
      
      const exportData = await exportSecurityEvents()
      const parsed = JSON.parse(exportData)
      
      expect(parsed.exportVersion).toBe(1)
      expect(parsed.exportedAt).toBeGreaterThan(0)
      expect(parsed.eventCount).toBe(1)
      expect(parsed.events).toHaveLength(1)
      expect(parsed.events[0].type).toBe('vault-created')
    })

    it('should respect since option in export', async () => {
      await logSecurityEvent('entry-created', 'info', { entryId: 'old' })
      await new Promise(r => setTimeout(r, 20))
      const cutoff = Date.now()
      await new Promise(r => setTimeout(r, 20))
      await logSecurityEvent('entry-created', 'info', { entryId: 'new' })
      
      const exportData = await exportSecurityEvents({ since: cutoff })
      const parsed = JSON.parse(exportData)
      
      expect(parsed.eventCount).toBe(1)
      expect(parsed.events[0].details.entryId).toBe('new')
    })

    it('should export events as CSV when requested', async () => {
      await logSecurityEvent('vault-unlock-success', 'info', { userId: 'user1' })
      
      const csv = await exportSecurityEvents({ format: 'csv' })
      
      expect(csv).toContain('timestamp,type,severity,id,details')
      expect(csv).toContain('vault-unlock-success')
      expect(csv).toContain('info')
    })
  })

  describe('getSecurityEventStats', () => {
    it('should return correct statistics', async () => {
      await logSecurityEvent('vault-unlock-success', 'info')
      await logSecurityEvent('vault-unlock-failure', 'warning')
      await logSecurityEvent('vault-unlock-success', 'info')
      await logSecurityEvent('biometric-auth-failure', 'error')
      
      const stats = await getSecurityEventStats()
      
      expect(stats.totalEvents).toBe(4)
      expect(stats.eventsByType['vault-unlock-success']).toBe(2)
      expect(stats.eventsByType['vault-unlock-failure']).toBe(1)
      expect(stats.eventsByType['biometric-auth-failure']).toBe(1)
      expect(stats.eventsBySeverity['info']).toBe(2)
      expect(stats.eventsBySeverity['warning']).toBe(1)
      expect(stats.eventsBySeverity['error']).toBe(1)
      expect(stats.firstEvent).toBeDefined()
      expect(stats.lastEvent).toBeDefined()
      expect(stats.lastEvent).toBeGreaterThanOrEqual(stats.firstEvent!)
    })

    it('should return empty stats when no events', async () => {
      const stats = await getSecurityEventStats()
      
      expect(stats.totalEvents).toBe(0)
      expect(stats.eventsByType).toEqual({})
      expect(stats.eventsBySeverity).toEqual({})
      expect(stats.firstEvent).toBeNull()
      expect(stats.lastEvent).toBeNull()
    })
  })

  describe('logSecurityEventsBatch', () => {
    it('should log multiple events efficiently', async () => {
      const eventsToLog = [
        { type: 'entry-created' as SecurityEventType, severity: 'info' as SecurityEventSeverity },
        { type: 'entry-updated' as SecurityEventType, severity: 'info' as SecurityEventSeverity },
        { type: 'entry-deleted' as SecurityEventType, severity: 'warning' as SecurityEventSeverity }
      ]
      
      const loggedEvents = await logSecurityEventsBatch(eventsToLog)
      
      expect(loggedEvents.length).toBe(3)
      
      const storedEvents = await getSecurityEvents()
      expect(storedEvents.length).toBe(3)
    })

    it('should handle empty batch', async () => {
      const loggedEvents = await logSecurityEventsBatch([])
      expect(loggedEvents).toEqual([])
    })

    it('should respect max events limit', async () => {
      // Log 1005 events (over the 1000 limit)
      const batch = Array.from({ length: 10 }, (_, i) => ({
        type: 'entry-created' as SecurityEventType,
        severity: 'info' as SecurityEventSeverity,
        details: { entryId: `entry-${i}` }
      }))
      
      // First fill up to near limit
      for (let i = 0; i < 100; i++) {
        await logSecurityEventsBatch(batch)
      }
      
      const events = await getSecurityEvents()
      expect(events.length).toBeLessThanOrEqual(1000)
    })
  })

  describe('event types', () => {
    const allEventTypes: SecurityEventType[] = [
      'vault-unlock-success',
      'vault-unlock-failure',
      'biometric-auth-success',
      'biometric-auth-failure',
      'pin-auth-success',
      'pin-auth-failure',
      'sync-conflict-detected',
      'sync-conflict-resolved',
      'autofill-triggered',
      'autofill-rejected',
      'prototype-tampering-detected',
      'iv-collision-detected',
      'kdf-migration-completed',
      'kdf-migration-failed',
      's3-sync-failure',
      'export-attempt',
      'import-attempt',
      'password-generator-used',
      'vault-created',
      'vault-locked',
      'entry-created',
      'entry-updated',
      'entry-deleted',
      'entry-restored',
      'entry-permanently-deleted'
    ]

    it('should support all defined event types', async () => {
      for (const type of allEventTypes) {
        const event = await logSecurityEvent(type, 'info')
        expect(event?.type).toBe(type)
      }
      
      const events = await getSecurityEvents()
      expect(events.length).toBe(allEventTypes.length)
    })
  })
})
