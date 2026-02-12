package com.lotus.android.update

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.lotus.android.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File

data class GithubRelease(
  val tagName: String,
  val name: String,
  val body: String,
  val publishedAt: String,
  val htmlUrl: String,
  val apkUrl: String?
)

data class UpdateUiState(
  val isChecking: Boolean = false,
  val isDownloading: Boolean = false,
  val currentVersion: String = BuildConfig.VERSION_NAME,
  val latest: GithubRelease? = null,
  val updateAvailable: Boolean = false,
  val statusMessage: String = "Check for updates to view latest release notes.",
  val errorMessage: String? = null
)

class GithubUpdater(
  private val okHttpClient: OkHttpClient = OkHttpClient(),
  private val json: Json = Json { ignoreUnknownKeys = true }
) {
  suspend fun fetchLatestRelease(): Result<GithubRelease> = withContext(Dispatchers.IO) {
    runCatching {
      val request = Request.Builder()
        .url("https://api.github.com/repos/${BuildConfig.UPDATE_REPO}/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .build()

      okHttpClient.newCall(request).execute().use { response ->
        if (!response.isSuccessful) {
          error("Release check failed (${response.code})")
        }
        val payload = response.body?.string().orEmpty()
        val root = json.parseToJsonElement(payload).jsonObject
        val assets = root["assets"]?.jsonArray ?: emptyList()
        val apk = assets
          .mapNotNull { asset ->
            val obj = asset.jsonObject
            val name = obj["name"]?.jsonPrimitive?.content ?: return@mapNotNull null
            val url = obj["browser_download_url"]?.jsonPrimitive?.content ?: return@mapNotNull null
            if (name.endsWith(".apk", ignoreCase = true)) url else null
          }
          .firstOrNull()

        GithubRelease(
          tagName = root["tag_name"]?.jsonPrimitive?.content ?: "unknown",
          name = root["name"]?.jsonPrimitive?.content ?: "Lotus Android Release",
          body = root["body"]?.jsonPrimitive?.content ?: "No release notes provided.",
          publishedAt = root["published_at"]?.jsonPrimitive?.content ?: "",
          htmlUrl = root["html_url"]?.jsonPrimitive?.content ?: "",
          apkUrl = apk
        )
      }
    }
  }

  fun isUpdateAvailable(currentVersion: String, latestTag: String): Boolean {
    val current = currentVersion.trim().removePrefix("v")
    val latest = latestTag.trim().removePrefix("v")
    val currentParts = current.split(".").mapNotNull { it.toIntOrNull() }
    val latestParts = latest.split(".").mapNotNull { it.toIntOrNull() }
    if (currentParts.isEmpty() || latestParts.isEmpty()) return current != latest
    val max = maxOf(currentParts.size, latestParts.size)
    repeat(max) { index ->
      val c = currentParts.getOrElse(index) { 0 }
      val l = latestParts.getOrElse(index) { 0 }
      if (l > c) return true
      if (l < c) return false
    }
    return false
  }

  suspend fun downloadReleaseApk(apkUrl: String, cacheDir: File): Result<File> = withContext(Dispatchers.IO) {
    runCatching {
      val request = Request.Builder().url(apkUrl).build()
      okHttpClient.newCall(request).execute().use { response ->
        if (!response.isSuccessful) {
          error("APK download failed (${response.code})")
        }
        val updatesDir = File(cacheDir, "updates").apply { mkdirs() }
        val target = File(updatesDir, "lotus-update.apk")
        response.body?.byteStream()?.use { input ->
          target.outputStream().use { output ->
            input.copyTo(output)
          }
        } ?: error("Empty APK payload")
        target
      }
    }
  }

  fun launchInstallOrPermissions(appContext: android.content.Context, apkFile: File): Result<String> = runCatching {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      !appContext.packageManager.canRequestPackageInstalls()
    ) {
      val settingsIntent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${appContext.packageName}")
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      appContext.startActivity(settingsIntent)
      return@runCatching "Enable \"Install unknown apps\" for Lotus, then tap Install again."
    }

    val uri = FileProvider.getUriForFile(
      appContext,
      "${appContext.packageName}.fileprovider",
      apkFile
    )
    val installIntent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, "application/vnd.android.package-archive")
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    appContext.startActivity(installIntent)
    "Installer opened for ${apkFile.name}."
  }
}
