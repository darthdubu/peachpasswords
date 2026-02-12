package com.lotus.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

enum class PeachAccent {
  LOTUS,
  APPLE,
  BANANA,
  CHERRY,
  GRAPE,
  LEMON,
  LIME,
  MANGO,
  PLUM,
  BERRY,
  COCONUT
}

@Immutable
data class PeachSpacing(
  val xxs: Int = 4,
  val xs: Int = 8,
  val sm: Int = 12,
  val md: Int = 16,
  val lg: Int = 20,
  val xl: Int = 24
)

val LocalPeachSpacing = staticCompositionLocalOf { PeachSpacing() }

private fun accentColor(accent: PeachAccent): Color = when (accent) {
  PeachAccent.LOTUS -> Color(0xFFE16E53)
  PeachAccent.APPLE -> Color(0xFFDC3D4B)
  PeachAccent.BANANA -> Color(0xFFE4C23B)
  PeachAccent.CHERRY -> Color(0xFFB83552)
  PeachAccent.GRAPE -> Color(0xFF7D5AC6)
  PeachAccent.LEMON -> Color(0xFFF2D24E)
  PeachAccent.LIME -> Color(0xFF6CC36C)
  PeachAccent.MANGO -> Color(0xFFF39A3D)
  PeachAccent.PLUM -> Color(0xFF6E4AAE)
  PeachAccent.BERRY -> Color(0xFF4F73D9)
  PeachAccent.COCONUT -> Color(0xFF7B675E)
}

@Composable
fun LotusTheme(
  accent: PeachAccent = PeachAccent.LOTUS,
  darkTheme: Boolean = isSystemInDarkTheme(),
  content: @Composable () -> Unit
) {
  val primary = accentColor(accent)
  val darkColors = darkColorScheme(
    primary = primary,
    secondary = primary.copy(alpha = 0.8f),
    tertiary = primary.copy(alpha = 0.65f),
    background = Color(0xFF0F1114),
    surface = Color(0xFF171A1F)
  )
  val lightColors = lightColorScheme(
    primary = primary,
    secondary = primary.copy(alpha = 0.8f),
    tertiary = primary.copy(alpha = 0.65f),
    background = Color(0xFFF9F9FB),
    surface = Color(0xFFFFFFFF)
  )

  MaterialTheme(
    colorScheme = if (darkTheme) darkColors else lightColors,
    typography = Typography,
    content = {
      androidx.compose.runtime.CompositionLocalProvider(
        LocalPeachSpacing provides PeachSpacing(),
        content = content
      )
    }
  )
}
