import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val appVersion: String = Regex("\"version\"\\s*:\\s*\"(\\d+\\.\\d+\\.\\d+)\"")
    .find(File(rootDir, "../package.json").readText())?.groupValues?.get(1) ?: "0.0.0"
val (major, minor, patch) = appVersion.split(".").map { it.toInt() }

val keystore = System.getenv("SAATHI_KEYSTORE")?.takeIf { it.isNotBlank() && File(it).exists() }

android {
    namespace = "io.github.akshatinnovate.saathi"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.akshatinnovate.saathi"
        minSdk = 26
        targetSdk = 35
        versionCode = major * 10000 + minor * 100 + patch
        versionName = appVersion
    }

    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = File(keystore)
                storePassword = System.getenv("SAATHI_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("SAATHI_KEY_ALIAS")
                keyPassword = System.getenv("SAATHI_KEY_PASSWORD")
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            if (keystore != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
        allWarningsAsErrors = true
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        disable += setOf("GradleDependency", "OldTargetApi", "AndroidGradlePluginVersion", "NewerVersionAvailable")
    }

    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
