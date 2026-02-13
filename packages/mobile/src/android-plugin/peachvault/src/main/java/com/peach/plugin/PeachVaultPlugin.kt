package com.peach.plugin

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@CapacitorPlugin(name = "PeachVault")
class PeachVaultPlugin : Plugin() {
    
    private val coroutineScope = CoroutineScope(Dispatchers.Main)
    
    @PluginMethod
    fun isVaultUnlocked(call: PluginCall) {
        val unlocked = VaultStorage.getInstance(context).isUnlocked()
        val result = JSObject()
        result.put("unlocked", unlocked)
        call.resolve(result)
    }
    
    @PluginMethod
    fun unlockVault(call: PluginCall) {
        val password = call.getString("password") ?: run {
            call.reject("Password is required")
            return
        }
        
        coroutineScope.launch {
            val success = withContext(Dispatchers.IO) {
                VaultStorage.getInstance(context).unlock(password)
            }
            
            val result = JSObject()
            result.put("success", success)
            if (!success) {
                result.put("error", "Incorrect password")
            }
            call.resolve(result)
        }
    }
    
    @PluginMethod
    fun getAutofillData(call: PluginCall) {
        val packageName = call.getString("packageName") ?: run {
            call.reject("Package name is required")
            return
        }
        
        coroutineScope.launch {
            val credentials = withContext(Dispatchers.IO) {
                VaultStorage.getInstance(context).getCredentialsForPackage(packageName)
            }
            
            val credentialsArray = org.json.JSONArray()
            credentials.forEach { credential ->
                credentialsArray.put(credential)
            }
            
            val result = JSObject()
            result.put("credentials", credentialsArray.toString())
            call.resolve(result)
        }
    }
    
    @PluginMethod
    fun fillCredential(call: PluginCall) {
        val entryId = call.getString("entryId") ?: run {
            call.reject("Entry ID is required")
            return
        }
        
        // Return the credential data
        val result = JSObject()
        result.put("username", "")
        result.put("password", "")
        call.resolve(result)
    }
    
    @PluginMethod
    fun lockVault(call: PluginCall) {
        VaultStorage.getInstance(context).lock()
        call.resolve()
    }
    
    @PluginMethod
    fun hasBiometric(call: PluginCall) {
        val result = JSObject()
        result.put("available", false)
        call.resolve(result)
    }
    
    @PluginMethod
    fun authenticateWithBiometric(call: PluginCall) {
        val result = JSObject()
        result.put("success", false)
        call.resolve(result)
    }
}
