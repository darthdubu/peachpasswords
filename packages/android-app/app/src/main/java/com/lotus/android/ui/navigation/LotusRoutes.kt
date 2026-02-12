package com.lotus.android.ui.navigation

sealed class LotusRoute(val route: String) {
  data object Unlock : LotusRoute("unlock")
  data object VaultList : LotusRoute("vault_list")
  data object VaultDetail : LotusRoute("vault_detail/{entryId}") {
    fun path(entryId: String): String = "vault_detail/$entryId"
  }
  data object EntryEdit : LotusRoute("entry_edit/{entryId}") {
    fun path(entryId: String): String = "entry_edit/$entryId"
  }
  data object Settings : LotusRoute("settings")
  data object Sync : LotusRoute("sync")
  data object Security : LotusRoute("security")
  data object Updates : LotusRoute("updates")
}
