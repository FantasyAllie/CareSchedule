plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The rota page is the same CareSchedule.html the desktop app uses (at the top of the repository),
// copied in with apps/config.json at build time – so there is only ever one copy to keep up to date.
abstract class CopyRotaPage : DefaultTask() {
    @get:InputFiles abstract val sources: ConfigurableFileCollection
    @get:OutputDirectory abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copy() {
        val out = outputDir.get().asFile
        out.deleteRecursively()
        out.mkdirs()
        sources.files.forEach { it.copyTo(File(out, it.name), overwrite = true) }
    }
}

val copyRotaPage = tasks.register<CopyRotaPage>("copyRotaPage") {
    sources.from(rootProject.file("../../CareSchedule.html"), rootProject.file("../config.json"))
}

// Signing your own builds (optional): set these four environment variables, or put the same names
// in ~/.gradle/gradle.properties. Without them you still get a debug build to install.
fun secret(name: String): String? = (findProperty(name) as String?) ?: System.getenv(name)

android {
    namespace = "uk.careschedule.rota"
    compileSdk = 35

    defaultConfig {
        applicationId = "uk.careschedule.rota"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.2.0"
    }

    signingConfigs {
        val store = secret("CS_KEYSTORE")
        if (store != null && file(store).exists()) {
            create("office") {
                storeFile = file(store)
                storePassword = secret("CS_KEYSTORE_PASSWORD")
                keyAlias = secret("CS_KEY_ALIAS")
                keyPassword = secret("CS_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("office")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyRotaPage, CopyRotaPage::outputDir)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
