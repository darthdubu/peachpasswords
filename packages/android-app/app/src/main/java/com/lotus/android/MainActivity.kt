package com.lotus.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import com.lotus.android.ui.LotusApp
import com.lotus.android.ui.state.LotusRootViewModel
import com.lotus.android.ui.theme.LotusTheme

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    setContent {
      val rootViewModel: LotusRootViewModel = viewModel()
      LotusTheme(accent = rootViewModel.accent) {
        LotusApp(rootViewModel = rootViewModel)
      }
    }
  }
}
