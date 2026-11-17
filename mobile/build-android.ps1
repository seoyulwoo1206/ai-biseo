# 안드로이드 앱(APK) 만들기: powershell -ExecutionPolicy Bypass -File mobile\build-android.ps1
# - 폰 화면 파일을 먼저 묶고(mobile/build.mjs), 안드로이드 스튜디오에 들어 있는 자바·그래들로 빌드한다.
# - 안드로이드 빌드 도구가 한글 경로를 못 읽어서, 잠깐 영어 드라이브 글자(subst)로 옮겨서 빌드한다.
# 결과: mobile\ai-assistant.apk
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $PSScriptRoot 'android'

Push-Location $root
node mobile/build.mjs
Pop-Location

$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$gradle = (Get-ChildItem "$env:USERPROFILE\.gradle\wrapper\dists\gradle-*-bin\*\gradle-*\bin\gradle.bat" | Sort-Object FullName -Descending | Select-Object -First 1).FullName
if (-not $gradle) { throw '그래들을 못 찾았어요. 안드로이드 스튜디오로 아무 프로젝트나 한 번 빌드해 주세요.' }

$sdk = "$env:LOCALAPPDATA\Android\Sdk" -replace '\\', '/'
Set-Content -Path (Join-Path $android 'local.properties') -Value "sdk.dir=$sdk" -Encoding ascii

$drive = @('Q', 'R', 'T', 'W', 'Y', 'Z') | Where-Object { -not (Test-Path "$($_):\") } | Select-Object -First 1
cmd /c "subst ${drive}: `"$android`""
try {
    Push-Location "${drive}:\"
    & $gradle assembleDebug --console=plain
    if ($LASTEXITCODE -ne 0) { throw '빌드 실패' }
    Pop-Location
    Copy-Item "$android\app\build\outputs\apk\debug\app-debug.apk" (Join-Path $PSScriptRoot 'ai-assistant.apk') -Force
    Write-Host "완료: $(Join-Path $PSScriptRoot 'ai-assistant.apk')"
} finally {
    Set-Location $root
    cmd /c "subst ${drive}: /d" | Out-Null
}
