package com.lotus.android.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.lotus.android.ui.navigation.LotusRoute
import com.lotus.android.ui.screens.SecurityScreen
import com.lotus.android.ui.screens.SettingsScreen
import com.lotus.android.ui.screens.SyncScreen
import com.lotus.android.ui.screens.UnlockScreen
import com.lotus.android.ui.screens.UpdatesScreen
import com.lotus.android.ui.screens.VaultListScreen
import com.lotus.android.ui.state.LotusRootViewModel

@Composable
fun LotusApp(rootViewModel: LotusRootViewModel) {
  val navController = rememberNavController()
  val state by rootViewModel.state.collectAsState()

  if (state.isLoading) {
    Scaffold(modifier = Modifier.fillMaxSize()) {
      CircularProgressIndicator()
    }
    return
  }

  NavHost(
    navController = navController,
    startDestination = if (state.unlocked) LotusRoute.VaultList.route else LotusRoute.Unlock.route
  ) {
    composable(LotusRoute.Unlock.route) {
      UnlockScreen(
        suggestedAuthMethod = state.suggestedAuthMethod,
        onUnlocked = {
          rootViewModel.markUnlocked()
          navController.navigate(LotusRoute.VaultList.route) {
            popUpTo(LotusRoute.Unlock.route) { inclusive = true }
          }
        }
      )
    }
    composable(LotusRoute.VaultList.route) {
      VaultListScreen(
        syncStatus = state.syncStatus,
        onOpenSettings = { navController.navigate(LotusRoute.Settings.route) },
        onOpenSync = { navController.navigate(LotusRoute.Sync.route) },
        onOpenSecurity = { navController.navigate(LotusRoute.Security.route) },
        onOpenUpdates = { navController.navigate(LotusRoute.Updates.route) }
      )
    }
    composable(LotusRoute.Settings.route) {
      SettingsScreen(onBack = { navController.popBackStack() })
    }
    composable(LotusRoute.Sync.route) {
      SyncScreen(onBack = { navController.popBackStack() })
    }
    composable(LotusRoute.Security.route) {
      SecurityScreen(onBack = { navController.popBackStack() })
    }
    composable(LotusRoute.Updates.route) {
      UpdatesScreen(onBack = { navController.popBackStack() })
    }
    composable(LotusRoute.VaultDetail.route) {
      Text("Vault detail shell")
    }
    composable(LotusRoute.EntryEdit.route) {
      Text("Vault edit shell")
    }
  }
}
