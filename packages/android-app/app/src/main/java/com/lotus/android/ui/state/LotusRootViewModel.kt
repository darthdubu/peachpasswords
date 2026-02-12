package com.lotus.android.ui.state

import androidx.lifecycle.ViewModel
import com.lotus.android.ui.theme.PeachAccent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class LotusRootState(
  val unlocked: Boolean = false,
  val isLoading: Boolean = true,
  val suggestedAuthMethod: String = "master_password",
  val syncStatus: String = "disconnected"
)

class LotusRootViewModel : ViewModel() {
  private val _state = MutableStateFlow(LotusRootState())
  val state: StateFlow<LotusRootState> = _state.asStateFlow()

  private val _accent = MutableStateFlow(PeachAccent.LOTUS)
  val accent: PeachAccent
    get() = _accent.value

  init {
    _state.update { it.copy(isLoading = false) }
  }

  fun markUnlocked() {
    _state.update { it.copy(unlocked = true) }
  }

  fun markLocked() {
    _state.update { it.copy(unlocked = false) }
  }

  fun setAccent(accent: PeachAccent) {
    _accent.value = accent
  }
}
