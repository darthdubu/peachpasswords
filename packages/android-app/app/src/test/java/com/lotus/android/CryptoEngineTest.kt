package com.lotus.android

import com.lotus.android.core.crypto.CryptoEngine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class CryptoEngineTest {
  @Test
  fun encryptDecrypt_roundTrip() {
    val crypto = CryptoEngine()
    val master = crypto.deriveMasterKey("secret".toCharArray(), "salt123456789012".toByteArray())
    val aad = "lotus.vault.v1:1"
    val payload = crypto.encryptUtf8("hello", master, aad)
    val plain = crypto.decryptUtf8(payload, master, aad)
    assertEquals("hello", plain)
  }

  @Test
  fun integrityHash_changesWhenVersionChanges() {
    val crypto = CryptoEngine()
    val a = crypto.computeIntegrityHash(listOf("a", "b"), 1)
    val b = crypto.computeIntegrityHash(listOf("a", "b"), 2)
    assertNotEquals(a, b)
  }
}
