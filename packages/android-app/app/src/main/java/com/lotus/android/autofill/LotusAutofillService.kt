package com.lotus.android.autofill

import android.app.assist.AssistStructure
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest

class LotusAutofillService : AutofillService() {
  override fun onFillRequest(
    request: FillRequest,
    cancellationSignal: CancellationSignal,
    callback: FillCallback
  ) {
    // Full inline dataset population comes in parity follow-up wiring.
    callback.onSuccess(FillResponse.Builder().build())
  }

  override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    callback.onSuccess()
  }

  private fun inferWebDomain(structure: AssistStructure): String {
    val nodeCount = structure.windowNodeCount
    for (i in 0 until nodeCount) {
      val root = structure.getWindowNodeAt(i).rootViewNode ?: continue
      val webDomain = root.webDomain
      if (!webDomain.isNullOrBlank()) return webDomain
    }
    return ""
  }
}
