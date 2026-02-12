package com.lotus.android.sync

import android.content.Context
import aws.sdk.kotlin.services.s3.S3Client
import aws.sdk.kotlin.services.s3.model.GetObjectRequest
import aws.sdk.kotlin.services.s3.model.HeadObjectRequest
import aws.sdk.kotlin.services.s3.model.PutObjectRequest
import aws.smithy.kotlin.runtime.auth.awscredentials.Credentials
import aws.smithy.kotlin.runtime.auth.awscredentials.CredentialsProvider
import aws.smithy.kotlin.runtime.net.url.Url
import com.lotus.android.core.crypto.CryptoEngine
import com.lotus.android.core.model.S3Settings
import com.lotus.android.core.model.Vault
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.ByteArrayInputStream
import aws.smithy.kotlin.runtime.content.ByteStream
import aws.smithy.kotlin.runtime.collections.Attributes

class S3SyncClient(private val context: Context) {
    private val json = Json { ignoreUnknownKeys = true }
    private val crypto = CryptoEngine(context)
    private val key = "lotus-vault-sync.json"
    
    data class SyncResult(
        val success: Boolean,
        val vault: Vault?,
        val conflicts: List<MergeConflict> = emptyList(),
        val message: String
    )

    data class MergeConflict(
        val entryId: String,
        val entryName: String
    )

    data class RemoteInfo(
        val etag: String?,
        val version: Long,
        val timestamp: Long,
        val exists: Boolean
    )
    
    suspend fun checkRemote(settings: S3Settings): Result<RemoteInfo> = withContext(Dispatchers.IO) {
        runCatching {
            createS3Client(settings).use { s3 ->
                try {
                    val response = s3.headObject(HeadObjectRequest {
                        bucket = settings.bucket
                        key = this@S3SyncClient.key
                    })
                    val metadata = response.metadata ?: emptyMap()
                    RemoteInfo(
                        etag = response.eTag,
                        version = metadata["version"]?.toLongOrNull() ?: 0,
                        timestamp = metadata["timestamp"]?.toLongOrNull() ?: 0,
                        exists = true
                    )
                } catch (e: Exception) {
                    if (e.message?.contains("404") == true || e.message?.contains("NoSuchKey") == true) {
                        RemoteInfo(null, 0, 0, false)
                    } else {
                        throw e
                    }
                }
            }
        }
    }
    
    suspend fun pullRemote(settings: S3Settings, masterKey: ByteArray): Result<Vault> = withContext(Dispatchers.IO) {
        runCatching {
            createS3Client(settings).use { s3 ->
                val responseBytes = s3.getObject(GetObjectRequest {
                    bucket = settings.bucket
                    key = this@S3SyncClient.key
                }) { resp ->
                    resp.body?.readAllBytes() ?: throw Exception("Empty response")
                }
                
                val payloadJson = String(responseBytes, Charsets.UTF_8)
                val payload = json.decodeFromString<EncryptedSyncPayload>(payloadJson)
                
                val vaultKey = crypto.deriveSubKey(masterKey, "vault-main")
                val vaultJson = crypto.decryptUtf8(payload.blob, vaultKey)
                
                json.decodeFromString<Vault>(vaultJson)
            }
        }
    }
    
    suspend fun pushLocal(vault: Vault, settings: S3Settings, masterKey: ByteArray, salt: ByteArray): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            createS3Client(settings).use { s3 ->
                val vaultKey = crypto.deriveSubKey(masterKey, "vault-main")
                val vaultJson = json.encodeToString(vault)
                val encrypted = crypto.encryptUtf8(vaultJson, vaultKey)
                
                val payload = EncryptedSyncPayload(
                    blob = encrypted,
                    version = vault.syncVersion,
                    salt = salt.map { it.toInt() },
                    timestamp = System.currentTimeMillis()
                )

                val payloadBytes = json.encodeToString(payload).toByteArray(Charsets.UTF_8)

                s3.putObject(PutObjectRequest {
                    bucket = settings.bucket
                    key = this@S3SyncClient.key
                    body = ByteStream.fromBytes(payloadBytes)
                    metadata = mapOf(
                        "version" to vault.syncVersion.toString(),
                        "timestamp" to System.currentTimeMillis().toString(),
                        "client" to "lotus-android"
                    )
                })
                Unit
            }
        }
    }
    
    suspend fun sync(localVault: Vault, baseVault: Vault?, settings: S3Settings, masterKey: ByteArray, salt: ByteArray): SyncResult = withContext(Dispatchers.IO) {
        try {
            val remoteInfo = checkRemote(settings).getOrNull()
            
            if (remoteInfo == null) {
                return@withContext SyncResult(false, localVault, emptyList(), "Failed to check remote")
            }
            
            if (!remoteInfo.exists) {
                pushLocal(localVault, settings, masterKey, salt)
                return@withContext SyncResult(true, localVault, emptyList(), "Uploaded to remote")
            }
            
            val remoteVault = pullRemote(settings, masterKey).getOrNull()
            
            if (remoteVault == null) {
                pushLocal(localVault, settings, masterKey, salt)
                return@withContext SyncResult(true, localVault, emptyList(), "Pushed to remote")
            }
            
            if (baseVault == null) {
                return@withContext SyncResult(false, localVault, emptyList(), "No base vault for merge")
            }
            
            val mergeResult = threeWayMerge(baseVault, localVault, remoteVault)
            val mergedVault = mergeResult.merged
            
            if (mergedVault.syncVersion != localVault.syncVersion) {
                pushLocal(mergedVault, settings, masterKey, salt)
            }
            
            SyncResult(
                success = true,
                vault = mergedVault,
                conflicts = mergeResult.conflicts.map { 
                    MergeConflict(it.entryId, it.entryName) 
                },
                message = if (mergeResult.conflicts.isEmpty()) "Sync successful" else "Sync with ${mergeResult.conflicts.size} conflicts"
            )
        } catch (e: Exception) {
            SyncResult(false, localVault, emptyList(), "Sync failed: ${e.message}")
        }
    }
    
    private fun createS3Client(settings: S3Settings): S3Client {
        return S3Client {
            region = settings.region
            endpointUrl = Url.parse(settings.displayEndpoint)
            forcePathStyle = settings.pathStyle
            credentialsProvider = object : CredentialsProvider {
                override suspend fun resolve(attributes: Attributes): Credentials {
                    return Credentials(
                        accessKeyId = settings.accessKey,
                        secretAccessKey = settings.secretKey
                    )
                }
            }
        }
    }
}

@kotlinx.serialization.Serializable
data class EncryptedSyncPayload(
    val blob: String,
    val version: Long,
    val salt: List<Int>,
    val timestamp: Long = System.currentTimeMillis()
)
