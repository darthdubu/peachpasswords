plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.serialization")
}

val updateRepo = (project.findProperty("LOTUS_UPDATE_REPO") as String?) ?: "darthdubu/peachpasswords"

android {
  namespace = "com.lotus.android"
  compileSdk = 35

  defaultConfig {
    applicationId = "com.lotus.android"
    minSdk = 28
    targetSdk = 35
    versionCode = 1
    versionName = "0.1.0"
    buildConfigField("String", "UPDATE_REPO", "\"$updateRepo\"")
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    vectorDrawables.useSupportLibrary = true
  }

  signingConfigs {
    create("release") {
      storeFile = file(project.findProperty("RELEASE_STORE_FILE") ?: "keystore.jks")
      storePassword = project.findProperty("RELEASE_STORE_PASSWORD")?.toString() ?: System.getenv("KEYSTORE_PASSWORD") ?: ""
      keyAlias = project.findProperty("RELEASE_KEY_ALIAS")?.toString() ?: System.getenv("KEY_ALIAS") ?: ""
      keyPassword = project.findProperty("RELEASE_KEY_PASSWORD")?.toString() ?: System.getenv("KEY_PASSWORD") ?: ""
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      signingConfig = signingConfigs.getByName("release")
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        "proguard-rules.pro"
      )
    }
    debug {
      signingConfig = signingConfigs.getByName("debug")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
  }

  // Configure Java toolchain
  java {
    toolchain {
      languageVersion.set(JavaLanguageVersion.of(17))
    }
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }

  composeOptions {
    kotlinCompilerExtensionVersion = "1.5.14"
  }

  packaging {
    resources {
      excludes += "/META-INF/{AL2.0,LGPL2.1}"
      excludes += "/META-INF/DUMMY.SF"
      excludes += "/META-INF/DUMMY.DSA"
      excludes += "/META-INF/BC1024KE.SF"
      excludes += "/META-INF/BC1024KE.DSA"
      excludes += "/META-INF/BC2048KE.SF"
      excludes += "/META-INF/BC2048KE.DSA"
    }
  }
}

dependencies {
  val composeBom = platform("androidx.compose:compose-bom:2024.09.00")
  implementation(composeBom)
  androidTestImplementation(composeBom)

  implementation("androidx.core:core-ktx:1.13.1")
  implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
  implementation("androidx.activity:activity-compose:1.9.2")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.ui:ui-tooling-preview")
  debugImplementation("androidx.compose.ui:ui-tooling")
  implementation("androidx.compose.material3:material3")
  implementation("com.google.android.material:material:1.12.0")
  implementation("androidx.navigation:navigation-compose:2.8.1")
  implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
  implementation("androidx.lifecycle:lifecycle-service:2.8.6")

  implementation("androidx.security:security-crypto:1.1.0-alpha06")
  implementation("androidx.biometric:biometric:1.2.0-alpha05")
  implementation("androidx.credentials:credentials:1.3.0")
  implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
  implementation("androidx.autofill:autofill:1.1.0")
  implementation("androidx.work:work-runtime-ktx:2.9.1")

  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
  implementation("org.jetbrains.kotlinx:kotlinx-datetime:0.6.1")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

  // AWS S3
  implementation(platform("aws.sdk.kotlin:bom:1.3.79"))
  implementation("aws.sdk.kotlin:s3:1.3.79")
  implementation("aws.smithy.kotlin:aws-credentials:1.3.3")

  implementation("org.bouncycastle:bcprov-jdk18on:1.78.1")

  testImplementation("junit:junit:4.13.2")
  testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
  androidTestImplementation("androidx.test.ext:junit:1.2.1")
  androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
  androidTestImplementation("androidx.compose.ui:ui-test-junit4")
  debugImplementation("androidx.compose.ui:ui-test-manifest")
}
