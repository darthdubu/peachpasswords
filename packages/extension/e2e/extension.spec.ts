import { test, expect } from '@playwright/test'

test.describe('Lotus Extension', () => {
  test('extension loads without errors', async ({ page }) => {
    await page.goto('chrome-extension://fake-id/popup.html')
    await expect(page.locator('body')).toBeVisible()
  })
})
