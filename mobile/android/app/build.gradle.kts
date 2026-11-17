plugins {
    id("com.android.application")
}

android {
    namespace = "com.aibiseo.assistant"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.aibiseo.assistant"
        minSdk = 30
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // 개인용: 따로 서명 키를 만들기 전까지는 디버그 키로 서명해서 바로 깔 수 있게
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
