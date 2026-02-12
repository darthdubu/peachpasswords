package com.lotus.android.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class SyncReplayWorker(
  context: Context,
  params: WorkerParameters
) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    // Worker orchestration gets wired in app DI setup.
    return Result.success()
  }
}
