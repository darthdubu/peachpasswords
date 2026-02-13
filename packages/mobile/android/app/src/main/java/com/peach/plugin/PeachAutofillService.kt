package com.peach.plugin

import android.app.assist.AssistStructure
import android.content.Context
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillContext
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import androidx.annotation.RequiresApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

@RequiresApi(Build.VERSION_CODES.O)
class PeachAutofillService : AutofillService() {

    private val coroutineScope = CoroutineScope(Dispatchers.Main)

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback
    ) {
        val context = request.fillContexts.last()
        val structure = context.structure
        
        coroutineScope.launch {
            try {
                val parsedStructure = parseAssistStructure(structure)
                val packageName = parsedStructure.packageName
                
                // Get credentials from vault
                val credentials = withContext(Dispatchers.IO) {
                    VaultStorage.getInstance(this@PeachAutofillService)
                        .getCredentialsForPackage(packageName)
                }
                
                if (credentials.isEmpty()) {
                    callback.onSuccess(null)
                    return@launch
                }
                
                val responseBuilder = FillResponse.Builder()
                
                // Build datasets for each credential
                credentials.forEach { credential ->
                    val dataset = buildDataset(parsedStructure, credential)
                    responseBuilder.addDataset(dataset)
                }
                
                // Add unlock dataset if vault is locked
                if (!VaultStorage.getInstance(this@PeachAutofillService).isUnlocked()) {
                    val unlockDataset = buildUnlockDataset(parsedStructure)
                    responseBuilder.addDataset(unlockDataset)
                }
                
                callback.onSuccess(responseBuilder.build())
            } catch (e: Exception) {
                callback.onFailure(e.message)
            }
        }
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        // TODO: Implement save functionality
        callback.onSuccess()
    }

    private fun parseAssistStructure(structure: AssistStructure): ParsedStructure {
        val packageName = structure.activityComponent?.packageName ?: ""
        val fields = mutableMapOf<String, AutofillId>()
        
        for (i in 0 until structure.windowNodeCount) {
            val windowNode = structure.getWindowNodeAt(i)
            traverseNode(windowNode.rootViewNode, fields)
        }
        
        return ParsedStructure(
            packageName = packageName,
            usernameId = fields["username"],
            passwordId = fields["password"]
        )
    }

    private fun traverseNode(node: AssistStructure.ViewNode, fields: MutableMap<String, AutofillId>) {
        val autofillId = node.autofillId
        
        if (autofillId != null) {
            when {
                isUsernameField(node) -> fields["username"] = autofillId
                isPasswordField(node) -> fields["password"] = autofillId
            }
        }
        
        for (i in 0 until node.childCount) {
            traverseNode(node.getChildAt(i), fields)
        }
    }

    private fun isUsernameField(node: AssistStructure.ViewNode): Boolean {
        val hints = node.autofillHints
        if (hints != null) {
            if (hints.contains("username") || hints.contains("email")) return true
        }
        
        val id = node.idEntry?.lowercase() ?: ""
        val className = node.className?.lowercase() ?: ""
        
        return id.contains("user") || 
               id.contains("email") || 
               id.contains("login") ||
               className.contains("email")
    }

    private fun isPasswordField(node: AssistStructure.ViewNode): Boolean {
        val hints = node.autofillHints
        if (hints != null) {
            if (hints.contains("password")) return true
        }
        
        return node.inputType == android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD ||
               node.inputType == android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
    }

    private fun buildDataset(
        structure: ParsedStructure,
        credential: JSONObject
    ): Dataset {
        val presentation = RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
            setTextViewText(android.R.id.text1, credential.getString("name"))
        }
        
        val builder = Dataset.Builder(presentation)
        
        structure.usernameId?.let { id ->
            builder.setValue(
                id,
                AutofillValue.forText(credential.optString("username", "")),
                RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
                    setTextViewText(android.R.id.text1, credential.getString("username"))
                }
            )
        }
        
        structure.passwordId?.let { id ->
            builder.setValue(
                id,
                AutofillValue.forText(credential.optString("password", "")),
                RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
                    setTextViewText(android.R.id.text1, "••••••••")
                }
            )
        }
        
        return builder.build()
    }

    private fun buildUnlockDataset(structure: ParsedStructure): Dataset {
        val presentation = RemoteViews(packageName, R.layout.autofill_unlock_prompt).apply {
            setTextViewText(R.id.title, "Unlock Peach Vault")
            setTextViewText(R.id.subtitle, "Tap to unlock")
        }
        
        val intent = android.content.Intent(this, UnlockActivity::class.java).apply {
            flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK or 
                    android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        
        val pendingIntent = android.app.PendingIntent.getActivity(
            this,
            0,
            intent,
            android.app.PendingIntent.FLAG_IMMUTABLE or 
            android.app.PendingIntent.FLAG_UPDATE_CURRENT
        )
        
        val builder = Dataset.Builder(presentation)
        
        structure.usernameId?.let { id ->
            builder.setValue(id, AutofillValue.forText(""))
        }
        
        builder.setAuthentication(pendingIntent.intentSender)
        
        return builder.build()
    }

    data class ParsedStructure(
        val packageName: String,
        val usernameId: AutofillId?,
        val passwordId: AutofillId?
    )
}
