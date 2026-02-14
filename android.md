# Peach Password Manager - Android Extension Strategy

## Overview

This document outlines the strategy for bringing Peach Password Manager to Android in a fluid and faithful way. Based on two previous failed attempts, this approach fundamentally rethinks the architecture to ensure success.

## The Problem with Previous Attempts

### Likely Causes of Failure
1. **Crypto incompatibility** - Attempting to reuse web crypto directly on Android
2. **UI fidelity loss** - Rebuilding UI from scratch instead of reusing existing components
3. **Sync complexity** - Trying to share code that shouldn't be shared between platforms
4. **Android lifecycle** - Not properly handling background/foreground transitions

### Lessons Learned
- Don't treat Android as a "port" - treat it as a first-class platform
- Web technologies don't translate 1:1 to mobile
- Android Autofill Framework requires native implementation
- Crypto must use platform-native secure hardware

---

## The Solution: Hybrid Native Approach

### Architecture Overview

```
Android App (Kotlin + Native)
├── Autofill Service (Android Framework)
│   ├── Field detection (native, inspired by TypeScript implementation)
│   ├── Credential presentation
│   └── Biometric prompt integration
├── WebView UI (Reuses existing React components)
│   ├── Vault view
│   ├── Entry editing
│   └── Settings
├── Crypto Bridge (Rust/WASM → JNI)
│   ├── Argon2id (same as extension)
│   ├── AES-GCM (same as extension)
│   └── Key derivation
└── Sync Layer (Kotlin Multiplatform)
    ├── S3 client
    ├── P2P networking
    └── Conflict resolution
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)

#### Step 1.1: Android Project Setup

**Project Configuration:**
- Min SDK: API 29 (Android 10) - required for Autofill Service
- Target SDK: API 34
- Language: Kotlin
- Architecture: MVVM with Clean Architecture

**Key Dependencies:**

```kotlin
// build.gradle.kts
dependencies {
    // Autofill Framework
    implementation("androidx.autofill:autofill:1.1.0")
    
    // Cryptography
    implementation("org.bouncycastle:bcprov-jdk15on:1.70")
    
    // WebView
    implementation("androidx.webkit:webkit:1.8.0")
    
    // S3 Sync
    implementation("aws.sdk.kotlin:s3:1.0.0")
    
    // P2P (WebRTC)
    implementation("io.github.webrtc-sdk:android:114.5735.08")
    
    // Biometric Authentication
    implementation("androidx.biometric:biometric:1.1.0")
    
    // Secure Storage
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    
    // Dependency Injection
    implementation("io.insert-koin:koin-android:3.5.0")
    
    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    
    // Serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.0")
}
```

#### Step 1.2: Rust Crypto Bridge

Create a Rust library that compiles for Android with the same crypto primitives as the browser extension.

```rust
// crypto-bridge/src/lib.rs
use std::ffi::{CStr, CString, c_char, c_int};
use argon2::{self, Config, ThreadMode, Variant, Version};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};

/// Derive key using Argon2id (same parameters as browser extension)
#[no_mangle]
pub extern "C" fn derive_key_android(
    password: *const c_char,
    salt: *const u8,
    salt_len: usize,
    memory_kb: u32,
    iterations: u32,
    output: *mut u8,
    output_len: usize
) -> c_int {
    let password = unsafe {
        CStr::from_ptr(password).to_str().unwrap_or("")
    };
    
    let salt = unsafe {
        std::slice::from_raw_parts(salt, salt_len)
    };
    
    let config = Config {
        variant: Variant::Argon2id,
        version: Version::Version13,
        mem_cost: memory_kb,
        time_cost: iterations,
        lanes: 4,
        thread_mode: ThreadMode::Parallel,
        secret: &[],
        ad: &[],
        hash_length: output_len as u32,
    };
    
    match argon2::hash_raw(password.as_bytes(), salt, &config) {
        Ok(hash) => {
            unsafe {
                std::ptr::copy_nonoverlapping(
                    hash.as_ptr(),
                    output,
                    output_len.min(hash.len())
                );
            }
            0 // Success
        }
        Err(_) => -1 // Error
    }
}

/// Encrypt data with AES-256-GCM
#[no_mangle]
pub extern "C" fn encrypt_aes_gcm(
    key: *const u8,
    key_len: usize,
    nonce: *const u8,
    nonce_len: usize,
    plaintext: *const u8,
    plaintext_len: usize,
    ciphertext: *mut u8,
    ciphertext_len: usize
) -> c_int {
    // Implementation using aes_gcm crate
    // ...
    0
}

/// Decrypt data with AES-256-GCM
#[no_mangle]
pub extern "C" fn decrypt_aes_gcm(
    key: *const u8,
    key_len: usize,
    nonce: *const u8,
    nonce_len: usize,
    ciphertext: *const u8,
    ciphertext_len: usize,
    plaintext: *mut u8,
    plaintext_len: usize
) -> c_int {
    // Implementation using aes_gcm crate
    // ...
    0
}
```

**Build Script:**

```bash
#!/bin/bash
# build-android.sh

# Install cargo-ndk if not present
cargo install cargo-ndk

# Build for all Android architectures
cargo ndk \
    -t armeabi-v7a \
    -t arm64-v8a \
    -t x86 \
    -t x86_64 \
    -o ../android/app/src/main/jniLibs \
    build --release
```

#### Step 1.3: Android Keystore Integration

Master key is stored in Android Keystore, never in memory unencrypted:

```kotlin
class SecureEnclave(private val context: Context) {
    
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply {
        load(null)
    }
    
    /**
     * Generate a master key that requires biometric authentication
     */
    fun generateMasterKey(): SecretKey {
        val keyGen = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        )
        
        keyGen.init(
            KeyGenParameterSpec.Builder(
                MASTER_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setUserAuthenticationValidityDurationSeconds(-1) // Every use
            .setInvalidatedByBiometricEnrollment(true)
            .setRandomizedEncryptionRequired(true)
            .build()
        )
        
        return keyGen.generateKey()
    }
    
    /**
     * Get existing master key or create new one
     */
    fun getMasterKey(): SecretKey {
        return keyStore.getKey(MASTER_KEY_ALIAS, null) as? SecretKey
            ?: generateMasterKey()
    }
    
    /**
     * Encrypt sensitive data with master key
     */
    fun encrypt(plaintext: ByteArray): EncryptedData {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getMasterKey())
        
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext)
        
        return EncryptedData(iv, ciphertext)
    }
    
    /**
     * Decrypt data (requires biometric auth)
     */
    fun decrypt(encryptedData: EncryptedData, cipher: Cipher): ByteArray {
        return cipher.doFinal(encryptedData.ciphertext)
    }
    
    companion object {
        private const val MASTER_KEY_ALIAS = "peach_master_key"
    }
}

data class EncryptedData(
    val iv: ByteArray,
    val ciphertext: ByteArray
)
```

---

### Phase 2: Autofill Service (Week 3-4)

**Critical Insight:** Don't try to port TypeScript autofill to Kotlin. Instead:
1. Port the algorithm concepts, not the code
2. Use Android's Autofill Framework properly
3. Rewrite field detection in Kotlin based on our patterns

#### Android Autofill Service Implementation

```kotlin
class PeachAutofillService : AutofillService() {
    
    private lateinit var vaultRepository: VaultRepository
    private lateinit var fieldDetector: FieldDetector
    
    override fun onCreate() {
        super.onCreate()
        vaultRepository = VaultRepository.getInstance(this)
        fieldDetector = FieldDetector()
    }
    
    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback
    ) {
        // Parse the view structure
        val structure = request.fillContexts.last().structure
        val parsedStructure = parseStructure(structure)
        
        // Find relevant fields
        val passwordFields = fieldDetector.findPasswordFields(parsedStructure)
        val usernameFields = fieldDetector.findUsernameFields(parsedStructure)
        
        if (passwordFields.isEmpty() && usernameFields.isEmpty()) {
            callback.onSuccess(null)
            return
        }
        
        // Get matching credentials from vault
        val packageName = request.clientState?.getString("packageName")
        val credentials = vaultRepository.getCredentialsForPackage(packageName)
        
        if (credentials.isEmpty()) {
            // No credentials, suggest saving
            callback.onSuccess(buildSaveInfoResponse(parsedStructure))
            return
        }
        
        // Build fill response with credentials
        val response = buildFillResponse(
            passwordFields = passwordFields,
            usernameFields = usernameFields,
            credentials = credentials,
            clientState = request.clientState
        )
        
        callback.onSuccess(response)
    }
    
    override fun onSaveRequest(
        request: SaveRequest,
        callback: SaveCallback
    ) {
        // Extract saved credentials
        val structure = request.fillContexts.last().structure
        val parsedStructure = parseStructure(structure)
        
        val username = extractUsername(parsedStructure)
        val password = extractPassword(parsedStructure)
        
        if (username != null && password != null) {
            // Trigger save dialog
            SaveCredentialActivity.show(this, username, password)
        }
        
        callback.onSuccess()
    }
    
    private fun buildFillResponse(
        passwordFields: List<Field>,
        usernameFields: List<Field>,
        credentials: List<Credential>,
        clientState: Bundle?
    ): FillResponse {
        val responseBuilder = FillResponse.Builder()
        
        // Build dataset for each credential
        credentials.forEach { credential ->
            val datasetBuilder = Dataset.Builder()
            
            // Set username field
            usernameFields.forEach { field ->
                datasetBuilder.setValue(
                    field.autofillId,
                    AutofillValue.forText(credential.username)
                )
            }
            
            // Set password field
            passwordFields.forEach { field ->
                datasetBuilder.setValue(
                    field.autofillId,
                    AutofillValue.forText(credential.password)
                )
            }
            
            // Set presentation (inline suggestion)
            datasetBuilder.setPresentation(
                createCredentialPresentation(credential)
            )
            
            responseBuilder.addDataset(datasetBuilder.build())
        }
        
        // Add "Open Peach" option
        responseBuilder.addDataset(
            buildOpenAppDataset(passwordFields.firstOrNull())
        )
        
        return responseBuilder.build()
    }
    
    private fun createCredentialPresentation(credential: Credential): RemoteViews {
        return RemoteViews(packageName, R.layout.item_credential).apply {
            setTextViewText(R.id.credential_name, credential.name)
            setTextViewText(R.id.credential_username, credential.username)
            setImageViewResource(R.id.credential_icon, R.drawable.ic_peach)
        }
    }
}
```

#### Field Detection in Kotlin

```kotlin
class FieldDetector {
    
    // Ported from field-scoring.ts
    private val USERNAME_PATTERNS = listOf(
        Regex("user", RegexOption.IGNORE_CASE),
        Regex("login", RegexOption.IGNORE_CASE),
        Regex("email", RegexOption.IGNORE_CASE),
        Regex("usr", RegexOption.IGNORE_CASE),
        Regex("account", RegexOption.IGNORE_CASE),
        Regex("acct", RegexOption.IGNORE_CASE),
        Regex("signin", RegexOption.IGNORE_CASE),
        Regex("session", RegexOption.IGNORE_CASE)
    )
    
    private val PASSWORD_PATTERNS = listOf(
        Regex("pass", RegexOption.IGNORE_CASE),
        Regex("password", RegexOption.IGNORE_CASE),
        Regex("pwd", RegexOption.IGNORE_CASE),
        Regex("secret", RegexOption.IGNORE_CASE),
        Regex("passphrase", RegexOption.IGNORE_CASE)
    )
    
    private val EMAIL_PATTERNS = listOf(
        Regex("email", RegexOption.IGNORE_CASE),
        Regex("e-mail", RegexOption.IGNORE_CASE),
        Regex("mail", RegexOption.IGNORE_CASE)
    )
    
    private val TOTP_PATTERNS = listOf(
        Regex("totp", RegexOption.IGNORE_CASE),
        Regex("otp", RegexOption.IGNORE_CASE),
        Regex("2fa", RegexOption.IGNORE_CASE),
        Regex("mfa", RegexOption.IGNORE_CASE),
        Regex("code", RegexOption.IGNORE_CASE),
        Regex("pin", RegexOption.IGNORE_CASE)
    )
    
    fun findPasswordFields(structure: ParsedStructure): List<Field> {
        return structure.fields.filter { field ->
            scorePasswordField(field) > 5
        }.sortedByDescending { scorePasswordField(it) }
    }
    
    fun findUsernameFields(structure: ParsedStructure): List<Field> {
        return structure.fields.filter { field ->
            scoreUsernameField(field) > 5
        }.sortedByDescending { scoreUsernameField(it) }
    }
    
    private fun scorePasswordField(field: Field): Int {
        var score = 0
        
        // Weight: 10 - Autocomplete hint
        if (field.autofillHints?.contains(View.AUTOFILL_HINT_PASSWORD) == true) {
            score += 10
        }
        
        // Weight: 8 - Input type
        if (field.inputType == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
            field.inputType == InputType.TYPE_NUMBER_VARIATION_PASSWORD) {
            score += 8
        }
        
        // Weight: 6 - HTML type attribute
        if (field.htmlInfo?.attributes?.get("type") == "password") {
            score += 6
        }
        
        // Weight: 6 - Name/ID patterns
        val nameId = "${field.idEntry} ${field.hints?.joinToString()}"
        if (PASSWORD_PATTERNS.any { it.containsMatchIn(nameId) }) {
            score += 6
        }
        
        return score
    }
    
    private fun scoreUsernameField(field: Field): Int {
        var score = 0
        
        // Weight: 10 - Autocomplete hint
        if (field.autofillHints?.contains(View.AUTOFILL_HINT_USERNAME) == true) {
            score += 10
        }
        
        // Weight: 8 - Email type
        if (field.autofillHints?.contains(View.AUTOFILL_HINT_EMAIL_ADDRESS) == true ||
            field.inputType == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS) {
            score += 8
        }
        
        // Weight: 6 - Name/ID patterns
        val nameId = "${field.idEntry} ${field.hints?.joinToString()}"
        if (USERNAME_PATTERNS.any { it.containsMatchIn(nameId) }) {
            score += 6
        }
        
        return score
    }
}

data class Field(
    val autofillId: AutofillId,
    val idEntry: String?,
    val autofillHints: List<String>?,
    val inputType: Int,
    val htmlInfo: ViewNode.HtmlInfo?
)
```

---

### Phase 3: WebView UI (Week 5-6)

**Don't rewrite the UI!** Reuse the existing React components via WebView.

#### Vault Activity with WebView

```kotlin
class VaultActivity : AppCompatActivity() {
    
    private lateinit var webView: WebView
    private lateinit var biometricPrompt: BiometricPrompt
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        setContentView(R.layout.activity_vault)
        
        setupWebView()
        setupBiometric()
    }
    
    private fun setupWebView() {
        webView = findViewById(R.id.webview)
        
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            cacheMode = WebSettings.LOAD_NO_CACHE // Security: Don't cache vault
        }
        
        // Add JavaScript bridge
        webView.addJavascriptInterface(WebAppInterface(this), "Android")
        
        // Load local extension UI
        webView.loadUrl("file:///android_asset/peach-ui/index.html")
        
        // Handle navigation
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                // Stay within the app
                return false
            }
        }
    }
    
    private fun setupBiometric() {
        val executor = ContextCompat.getMainExecutor(this)
        
        biometricPrompt = BiometricPrompt(this, executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(
                    result: AuthenticationResult
                ) {
                    val cipher = result.cryptoObject?.cipher
                    val encryptedMasterKey = getEncryptedMasterKey()
                    
                    try {
                        val masterKey = cipher?.doFinal(encryptedMasterKey)
                        // Pass decrypted key to WebView
                        webView.evaluateJavascript(
                            "window.unlockVault('${masterKey?.toBase64()}')",
                            null
                        )
                    } catch (e: Exception) {
                        showError("Failed to decrypt vault")
                    }
                }
                
                override fun onAuthenticationFailed() {
                    showError("Authentication failed")
                }
            })
    }
    
    /**
     * Show biometric prompt for vault unlock
     */
    fun requestUnlock() {
        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock Peach")
            .setSubtitle("Use biometric authentication")
            .setDeviceCredentialAllowed(false)
            .setConfirmationRequired(false)
            .build()
        
        val cipher = getCipherForDecryption()
        biometricPrompt.authenticate(
            promptInfo,
            BiometricPrompt.CryptoObject(cipher)
        )
    }
    
    /**
     * JavaScript Interface for WebView
     */
    inner class WebAppInterface(private val context: Context) {
        
        @JavascriptInterface
        fun isAndroid(): Boolean = true
        
        @JavascriptInterface
        fun requestBiometricAuth(): String {
            runOnUiThread { requestUnlock() }
            return "requested"
        }
        
        @JavascriptInterface
        fun getVaultData(): String {
            return vaultRepository.getEncryptedVault()
        }
        
        @JavascriptInterface
        fun saveVault(encryptedVault: String) {
            vaultRepository.saveEncryptedVault(encryptedVault)
        }
        
        @JavascriptInterface
        fun getPasskeysForSite(site: String): String {
            val passkeys = passkeyRepository.getForSite(site)
            return Json.encodeToString(passkeys)
        }
        
        @JavascriptInterface
        fun createPasskey(options: String): String {
            // Delegate to native WebAuthn
            return passkeyManager.create(options)
        }
        
        @JavascriptInterface
        fun getPasskey(options: String): String {
            // Delegate to native WebAuthn
            return passkeyManager.get(options)
        }
        
        @JavascriptInterface
        fun syncNow(): String {
            GlobalScope.launch {
                syncManager.syncNow()
            }
            return "syncing"
        }
        
        @JavascriptInterface
        fun copyToClipboard(text: String) {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = ClipData.newPlainText("Peach", text)
            clipboard.setPrimaryClip(clip)
        }
        
        @JavascriptInterface
        fun openExternalLink(url: String) {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            startActivity(intent)
        }
        
        @JavascriptInterface
        fun shareCredential(title: String, content: String) {
            val shareIntent = Intent().apply {
                action = Intent.ACTION_SEND
                type = "text/plain"
                putExtra(Intent.EXTRA_TITLE, title)
                putExtra(Intent.EXTRA_TEXT, content)
            }
            startActivity(Intent.createChooser(shareIntent, "Share via"))
        }
    }
}
```

#### Build Process for Web Assets

```json
// package.json (in extension)
{
  "scripts": {
    "build:android": "npm run build && npm run copy:android",
    "copy:android": "cp -r dist/* ../android/app/src/main/assets/peach-ui/"
  }
}
```

**Build output structure:**
```
android/app/src/main/assets/peach-ui/
├── index.html
├── assets/
│   ├── index-[hash].js
│   ├── index-[hash].css
│   └── logo.svg
└── manifest.json
```

---

### Phase 4: Sync Implementation (Week 7-8)

#### S3 Sync with Kotlin Multiplatform

```kotlin
class S3SyncManager(
    private val context: Context,
    private val vaultRepository: VaultRepository
) {
    private val s3Client: S3Client
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    init {
        val config = loadS3Config()
        s3Client = S3Client {
            region = config.region
            credentialsProvider = StaticCredentialsProvider(
                accessKeyId = config.accessKey,
                secretAccessKey = config.secretKey
            )
            endpointUrl = Url.parse(config.endpoint)
        }
    }
    
    /**
     * Upload encrypted vault to S3
     */
    suspend fun uploadVault(): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val encryptedVault = vaultRepository.getEncryptedVault()
            val config = loadS3Config()
            
            s3Client.putObject {
                bucket = config.bucket
                key = "vaults/${config.userId}/vault.enc"
                body = ByteStream.fromBytes(encryptedVault.toByteArray())
                metadata = mapOf(
                    "x-amz-meta-version" to vaultRepository.getVersion().toString(),
                    "x-amz-meta-timestamp" to System.currentTimeMillis().toString()
                )
            }
            
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    /**
     * Download vault from S3
     */
    suspend fun downloadVault(): Result<String> = withContext(Dispatchers.IO) {
        try {
            val config = loadS3Config()
            
            val response = s3Client.getObject {
                bucket = config.bucket
                key = "vaults/${config.userId}/vault.enc"
            }
            
            val vaultData = response.body?.readAllBytes()?.toString(Charsets.UTF_8)
                ?: return@withContext Result.failure(Exception("Empty response"))
            
            Result.success(vaultData)
        } catch (e: NoSuchKey) {
            Result.failure(Exception("No vault found"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    /**
     * Two-way sync with conflict resolution
     */
    suspend fun sync(): SyncResult = withContext(Dispatchers.IO) {
        try {
            val localVersion = vaultRepository.getVersion()
            val remoteVaultResult = downloadVault()
            
            if (remoteVaultResult.isFailure) {
                // No remote vault, upload local
                uploadVault()
                return@withContext SyncResult.Uploaded
            }
            
            val remoteVault = remoteVaultResult.getOrThrow()
            val remoteVersion = extractVersion(remoteVault)
            
            when {
                localVersion > remoteVersion -> {
                    // Local is newer, upload
                    uploadVault()
                    SyncResult.Uploaded
                }
                remoteVersion > localVersion -> {
                    // Remote is newer, download
                    vaultRepository.saveEncryptedVault(remoteVault)
                    SyncResult.Downloaded
                }
                else -> {
                    // Versions match
                    SyncResult.InSync
                }
            }
        } catch (e: Exception) {
            SyncResult.Error(e.message ?: "Unknown error")
        }
    }
    
    /**
     * Start background sync worker
     */
    fun startBackgroundSync() {
        val syncWork = PeriodicWorkRequestBuilder<SyncWorker>(
            15, TimeUnit.MINUTES
        ).build()
        
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "vault_sync",
            ExistingPeriodicWorkPolicy.KEEP,
            syncWork
        )
    }
}

class SyncWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {
    
    override suspend fun doWork(): Result {
        val syncManager = SyncManager.getInstance(applicationContext)
        
        return when (val result = syncManager.sync()) {
            is SyncResult.Error -> Result.retry()
            else -> Result.success()
        }
    }
}

sealed class SyncResult {
    object Uploaded : SyncResult()
    object Downloaded : SyncResult()
    object InSync : SyncResult()
    data class Error(val message: String) : SyncResult()
}
```

#### P2P Sync with WebRTC

```kotlin
class P2PSyncManager(
    private val context: Context
) {
    private var peerConnectionFactory: PeerConnectionFactory
    private var peerConnections = mutableMapOf<String, PeerConnection>()
    private val dataChannels = mutableMapOf<String, DataChannel>()
    
    init {
        // Initialize WebRTC
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .createInitializationOptions()
        )
        
        peerConnectionFactory = PeerConnectionFactory.builder()
            .createPeerConnectionFactory()
    }
    
    /**
     * Connect to a peer for sync
     */
    fun connectToPeer(peerId: String, signalingData: SignalingData) {
        val iceServers = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer()
        )
        
        val rtcConfig = PeerConnection.RTCConfiguration(iceServers)
        
        val peerConnection = peerConnectionFactory.createPeerConnection(
            rtcConfig,
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate?) {
                    // Send to signaling server
                }
                
                override fun onDataChannel(dataChannel: DataChannel?) {
                    dataChannel?.let {
                        setupDataChannel(peerId, it)
                    }
                }
                
                // ... other callbacks
            }
        )
        
        peerConnections[peerId] = peerConnection!!
        
        // Create data channel for sync
        val dataChannelInit = DataChannel.Init()
        val dataChannel = peerConnection.createDataChannel("sync", dataChannelInit)
        setupDataChannel(peerId, dataChannel)
    }
    
    private fun setupDataChannel(peerId: String, dataChannel: DataChannel) {
        dataChannels[peerId] = dataChannel
        
        dataChannel.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) {}
            
            override fun onStateChange() {
                if (dataChannel.state() == DataChannel.State.OPEN) {
                    // Start sync
                    initiateSync(peerId)
                }
            }
            
            override fun onMessage(buffer: DataChannel.Buffer?) {
                buffer?.let {
                    handleSyncMessage(peerId, it)
                }
            }
        })
    }
    
    /**
     * Send encrypted vault delta to peer
     */
    private fun sendVaultDelta(peerId: String, delta: VaultDelta) {
        val dataChannel = dataChannels[peerId] ?: return
        
        val message = Json.encodeToString(delta)
        val buffer = ByteBuffer.wrap(message.toByteArray())
        
        dataChannel.send(DataChannel.Buffer(buffer, false))
    }
}
```

---

### Phase 5: Polish & Integration (Week 9-10)

#### Performance Optimizations

```kotlin
/**
 * Memory management for sensitive data
 */
class SecureMemoryManager {
    
    /**
     * Clear sensitive data from memory
     */
    fun clearSensitiveData() {
        // Clear WebView cache
        WebStorage.getInstance().deleteAllData()
        
        // Clear clipboard if it contains sensitive data
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        if (clipboard.hasPrimaryClip()) {
            clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
        }
        
        // Trigger GC to clear any lingering references
        System.gc()
    }
    
    /**
     * Auto-lock when app goes to background
     */
    fun setupAutoLock(activity: Activity) {
        val lifecycleObserver = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> {
                    // Lock vault after delay
                    Handler(Looper.getMainLooper()).postDelayed({
                        lockVault()
                    }, AUTO_LOCK_DELAY_MS)
                }
                Lifecycle.Event.ON_RESUME -> {
                    // Cancel pending lock
                    Handler(Looper.getMainLooper()).removeCallbacksAndMessages(null)
                }
                else -> {}
            }
        }
        
        activity.lifecycle.addObserver(lifecycleObserver)
    }
}

/**
 * Battery optimization
 */
class BatteryOptimizer {
    
    /**
     * Request battery optimization exemption
     */
    fun requestExemption(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            
            if (!powerManager.isIgnoringBatteryOptimizations(context.packageName)) {
                val intent = Intent().apply {
                    action = Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
                    data = Uri.parse("package:${context.packageName}")
                }
                context.startActivity(intent)
            }
        }
    }
    
    /**
     * Use WorkManager for efficient background sync
     */
    fun scheduleEfficientSync(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.UNMETERED)
            .setRequiresBatteryNotLow(true)
            .build()
        
        val syncWork = PeriodicWorkRequestBuilder<SyncWorker>(
            15, TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                WorkRequest.MIN_BACKOFF_MILLIS,
                TimeUnit.MILLISECONDS
            )
            .build()
        
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "vault_sync",
            ExistingPeriodicWorkPolicy.KEEP,
            syncWork
        )
    }
}
```

#### Error Handling & Recovery

```kotlin
class ErrorHandler {
    
    /**
     * Handle sync failures gracefully
     */
    fun handleSyncError(error: Throwable): SyncErrorAction {
        return when (error) {
            is UnknownHostException -> {
                // Network unavailable, retry later
                SyncErrorAction.RetryWithDelay(5, TimeUnit.MINUTES)
            }
            is S3Exception -> {
                when (error.statusCode) {
                    403 -> SyncErrorAction.Reauthenticate
                    404 -> SyncErrorAction.UploadLocal // No remote vault
                    else -> SyncErrorAction.RetryWithDelay(1, TimeUnit.MINUTES)
                }
            }
            is CryptoException -> {
                // Serious issue - log and notify user
                SyncErrorAction.NotifyUser("Encryption error. Please re-login.")
            }
            else -> SyncErrorAction.RetryWithDelay(30, TimeUnit.SECONDS)
        }
    }
    
    /**
     * Vault corruption recovery
     */
    suspend fun recoverVault(context: Context): Boolean {
        // Try to restore from backup
        val backupManager = BackupManager.getInstance(context)
        
        return try {
            val backup = backupManager.getLatestBackup()
            if (backup != null) {
                backupManager.restore(backup)
                true
            } else {
                false
            }
        } catch (e: Exception) {
            false
        }
    }
}
```

---

## Critical Differences from Previous Attempts

| Aspect | Previous Attempts | This Approach |
|--------|------------------|---------------|
| **Crypto** | Web Crypto polyfill | Rust bridge + Android Keystore |
| **UI** | Rebuilt in native Android | WebView with existing React components |
| **Autofill** | Custom implementation | Native Android Autofill Service |
| **Sync** | Shared TypeScript code | Kotlin Multiplatform |
| **Storage** | Filesystem | Encrypted SharedPreferences + Keystore |
| **Lifecycle** | Ignored | Proper foreground/background handling |
| **Biometric** | Optional | Required for master key access |

---

## Testing Strategy

### 1. Unit Tests
```kotlin
@Test
fun `detects password field by type`() {
    val field = createField(
        inputType = InputType.TYPE_TEXT_VARIATION_PASSWORD
    )
    
    val score = fieldDetector.scorePasswordField(field)
    
    assertTrue(score > 5)
}
```

### 2. Integration Tests
```kotlin
@Test
fun `autofill presents credentials for matching package`() {
    val service = PeachAutofillService()
    val request = createFillRequest(packageName = "com.github.android")
    
    val response = service.onFillRequest(request)
    
    assertNotNull(response.datasets)
    assertTrue(response.datasets.isNotEmpty())
}
```

### 3. Device Testing
- Test on 10+ real devices (different manufacturers, Android versions)
- Test autofill with top 50 Android apps
- Performance: <2s unlock time, <500ms autofill presentation
- Battery: <1% daily background usage

### 4. Security Testing
- Memory dump analysis (ensure keys not in RAM when locked)
- Network traffic analysis (ensure all data encrypted)
- Keystore validation (ensure hardware-backed when available)

---

## Key Success Factors

1. **Don't share code, share logic** - Port algorithms, not TypeScript code
2. **Android-first for mobile** - Don't treat it as a second-class platform
3. **Reuse UI via WebView** - Maintains consistency, reduces development time
4. **Rust for crypto** - Same implementation on both platforms
5. **Proper lifecycle handling** - Android kills background apps aggressively
6. **Hardware security** - Use Android Keystore + BiometricPrompt
7. **Incremental delivery** - Each phase delivers value independently

---

## Why This Will Succeed

1. **Lower risk** - Reusing proven UI reduces unknowns
2. **Better performance** - Native Android patterns, not web ports
3. **Faithful reproduction** - Same crypto, same sync, same UX
4. **Maintainable** - Clear separation of concerns
5. **Testable** - Each component can be tested independently
6. **Scalable** - Kotlin Multiplatform allows future iOS sharing

---

## Next Steps

1. **Set up Android project** with dependencies
2. **Build Rust crypto bridge** for Android targets
3. **Implement SecureEnclave** with Keystore
4. **Create basic Autofill Service** shell
5. **Set up WebView** with existing React UI

**Estimated Timeline:** 10 weeks to production-ready MVP

---

## Questions to Resolve

1. Should we support Android 9 (API 28) or stick to 10+?
2. Do we need F-Droid distribution or just Play Store?
3. Should we support Wear OS companion app?
4. Tablet UI - separate layouts or responsive WebView?

---

*Document Version: 1.0*
*Last Updated: 2026-02-13*
*Status: Planning Phase*
