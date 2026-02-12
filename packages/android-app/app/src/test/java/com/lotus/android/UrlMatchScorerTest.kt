package com.lotus.android

import com.lotus.android.autofill.UrlMatchScorer
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlMatchScorerTest {
  @Test
  fun exactHostProducesHighScore() {
    val score = UrlMatchScorer.getUrlMatchScore("https://app.example.com/login", "https://app.example.com")
    assertTrue(score.score >= 95)
  }

  @Test
  fun relatedSubdomainStillMatches() {
    val score = UrlMatchScorer.getUrlMatchScore("https://auth.example.com", "https://www.example.com")
    assertTrue(score.score >= 80)
  }
}
