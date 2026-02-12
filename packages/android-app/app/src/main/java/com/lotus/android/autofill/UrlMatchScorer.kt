package com.lotus.android.autofill

import java.net.URI

data class UrlMatchScore(
  val score: Int,
  val reason: String
)

object UrlMatchScorer {
  fun getUrlMatchScore(siteUrl: String, storedUrl: String): UrlMatchScore {
    val siteHost = parseHost(siteUrl)
    val storedHost = parseHost(storedUrl)
    if (siteHost.isEmpty() || storedHost.isEmpty()) return UrlMatchScore(0, "invalid-host")
    if (siteHost == storedHost) return UrlMatchScore(100, "exact-host")

    val siteRoot = rootHost(siteHost)
    val storedRoot = rootHost(storedHost)
    if (siteRoot == storedRoot) {
      val authLike = listOf("auth", "login", "signin", "account").any { token ->
        siteHost.contains(token) || storedHost.contains(token)
      }
      return UrlMatchScore(if (authLike) 92 else 82, if (authLike) "related-auth-subdomain" else "related-domain")
    }
    return UrlMatchScore(0, "no-match")
  }

  private fun parseHost(url: String): String = runCatching {
    val normalized = if (url.startsWith("http://") || url.startsWith("https://")) url else "https://$url"
    URI(normalized).host.orEmpty().lowercase().removePrefix("www.")
  }.getOrDefault("")

  private fun rootHost(host: String): String {
    val parts = host.split(".")
    return if (parts.size >= 2) parts.takeLast(2).joinToString(".") else host
  }
}
