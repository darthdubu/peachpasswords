package com.lotus.android.autofill

import com.lotus.android.core.model.VaultEntry

data class RankedCredential(
  val entry: VaultEntry,
  val score: Int
)

object CredentialRanker {
  fun rank(entries: List<VaultEntry>, currentUrl: String): List<RankedCredential> {
    return entries.map { entry ->
      val topMatch = entry.login?.urls.orEmpty().maxOfOrNull { candidate ->
        UrlMatchScorer.getUrlMatchScore(currentUrl, candidate).score
      } ?: 0
      val recencyBoost = ((entry.modified / 1000L) % 11L).toInt()
      RankedCredential(entry = entry, score = topMatch + recencyBoost)
    }.sortedByDescending { it.score }
  }
}
