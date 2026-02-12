package com.lotus.android

import com.lotus.android.totp.TotpManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class TotpManagerTest {
  @Test
  fun parsesOtpauthUri() {
    val manager = TotpManager()
    val parsed = manager.parseOtpauth("otpauth://totp/Lotus:test?secret=JBSWY3DPEHPK3PXP&issuer=Lotus&digits=6&period=30")
    assertNotNull(parsed)
    assertEquals("Lotus", parsed?.issuer)
  }

  @Test
  fun codeHasExpectedLength() {
    val manager = TotpManager()
    val code = manager.currentCode("JBSWY3DPEHPK3PXP", digits = 6, period = 30, timeMs = 1_700_000_000_000)
    assertEquals(6, code.length)
  }
}
