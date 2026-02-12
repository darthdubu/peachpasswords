package com.lotus.android.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun UnlockScreen(
  suggestedAuthMethod: String,
  onUnlocked: () -> Unit
) {
  Column(
    modifier = Modifier
      .fillMaxSize()
      .padding(20.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally
  ) {
    Text("Welcome back to Lotus", style = MaterialTheme.typography.headlineMedium)
    Text("Suggested unlock: $suggestedAuthMethod", modifier = Modifier.padding(top = 10.dp, bottom = 20.dp))
    Button(onClick = onUnlocked) {
      Text("Unlock")
    }
  }
}
