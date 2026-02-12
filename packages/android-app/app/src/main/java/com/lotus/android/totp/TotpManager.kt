package com.lotus.android.totp

import android.util.Base64
import java.nio.ByteBuffer
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.math.pow

class TotpManager {
  fun parseOtpauth(uri: String): ParsedTotp? {
    if (!uri.startsWith("otpauth://totp/")) return null
    val rawQuery = uri.substringAfter("?", "")
    val params = rawQuery.split("&").mapNotNull {
      val pair = it.split("=", limit = 2)
      if (pair.size == 2) pair[0] to pair[1] else null
    }.toMap()
    val secret = params["secret"] ?: return null
    return ParsedTotp(
      secret = normalizeSecret(secret),
      issuer = params["issuer"],
      algorithm = (params["algorithm"] ?: "SHA1").uppercase(),
      digits = (params["digits"] ?: "6").toIntOrNull() ?: 6,
      period = (params["period"] ?: "30").toIntOrNull() ?: 30
    )
  }

  fun currentCode(secret: String, algorithm: String = "SHA1", digits: Int = 6, period: Int = 30, timeMs: Long = System.currentTimeMillis()): String {
    val key = decodeBase32(normalizeSecret(secret))
    val counter = (timeMs / 1000L) / period
    val message = ByteBuffer.allocate(8).putLong(counter).array()
    val mac = Mac.getInstance("Hmac$algorithm")
    mac.init(SecretKeySpec(key, "Hmac$algorithm"))
    val hash = mac.doFinal(message)
    val offset = hash.last().toInt() and 0x0f
    val code = ((hash[offset].toInt() and 0x7f) shl 24) or
      ((hash[offset + 1].toInt() and 0xff) shl 16) or
      ((hash[offset + 2].toInt() and 0xff) shl 8) or
      (hash[offset + 3].toInt() and 0xff)
    val mod = 10.0.pow(digits.toDouble()).toInt()
    return (code % mod).toString().padStart(digits, '0')
  }

  fun remainingSeconds(period: Int, timeMs: Long = System.currentTimeMillis()): Int {
    val epoch = timeMs / 1000L
    return (period - (epoch % period)).toInt()
  }

  private fun normalizeSecret(secret: String): String =
    secret.replace(" ", "").replace("=", "").uppercase()

  private fun decodeBase32(secret: String): ByteArray {
    val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    var buffer = 0
    var bitsLeft = 0
    val output = mutableListOf<Byte>()
    secret.forEach { char ->
      val value = alphabet.indexOf(char)
      if (value == -1) return@forEach
      buffer = (buffer shl 5) or value
      bitsLeft += 5
      if (bitsLeft >= 8) {
        output += ((buffer shr (bitsLeft - 8)) and 0xFF).toByte()
        bitsLeft -= 8
      }
    }
    return output.toByteArray()
  }
}

data class ParsedTotp(
  val secret: String,
  val issuer: String?,
  val algorithm: String,
  val digits: Int,
  val period: Int
)
