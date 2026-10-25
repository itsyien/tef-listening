param([switch]$FormalRelease)
# Formal builds require the separately verified cloud acceptance gate.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$acceptancePath = Join-Path $projectRoot 'release\cloud-acceptance.json'
function Assert-CloudAcceptance {
    if (!(Test-Path -LiteralPath $acceptancePath) -or (Get-Content -LiteralPath $acceptancePath -Raw | ConvertFrom-Json).ready -ne $true) {
        throw 'Formal APK blocked: release/cloud-acceptance.json must have ready:true.'
    }
}
if ($FormalRelease) { Assert-CloudAcceptance }
$signingFolder = Join-Path $env:USERPROFILE '.android\tef-listening-release'
$env:JAVA_HOME = Join-Path $env:USERPROFILE '.jdks\openjdk-26.0.1'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:TEF_RELEASE = '1'
$env:EXPO_PUBLIC_API_URL = 'https://ucocgwfezhizpuqqrbje.supabase.co/functions/v1/tef-api'
$env:EXPO_PUBLIC_CLOUD_MODE = '1'
Remove-Item Env:DEEPSEEK_API_KEY,Env:DASHSCOPE_API_KEY -ErrorAction SilentlyContinue
$env:CI = '1'
$env:NODE_ENV = 'production'
$env:TEF_ANDROID_KEYSTORE_PATH = Join-Path $signingFolder 'tef-listening-release.p12'
$env:TEF_ANDROID_KEY_ALIAS = 'tef-listening-release'
try {
    # Read directly into private process environment; never print signing material.
    $env:TEF_ANDROID_STORE_PASSWORD = [IO.File]::ReadAllText((Join-Path $signingFolder 'release-signing-password.txt')).Trim()
    $env:TEF_ANDROID_KEY_PASSWORD = $env:TEF_ANDROID_STORE_PASSWORD
    if (!(Test-Path -LiteralPath $env:TEF_ANDROID_KEYSTORE_PATH) -or !$env:TEF_ANDROID_STORE_PASSWORD) { throw 'Local release signing material is missing.' }
    Push-Location (Join-Path $projectRoot 'mobile\android')
    try {
        $tasks = if ($FormalRelease) { @(':app:clean', ':app:assembleRelease') } else { @(':app:assembleRelease') }
        $architectures = if ($FormalRelease) { '-PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64' } else { '-PreactNativeArchitectures=arm64-v8a,armeabi-v7a' }
        & .\gradlew.bat @tasks --no-daemon --no-configuration-cache --max-workers=2 $architectures '-Dorg.gradle.internal.http.connectionTimeout=60000' '-Dorg.gradle.internal.http.socketTimeout=60000'
        if ($LASTEXITCODE -ne 0) { throw "Android release build failed (exit $LASTEXITCODE)." }
    } finally { Pop-Location }
    $apk = Join-Path $projectRoot 'mobile\android\app\build\outputs\apk\release\app-release.apk'
    $tools = Join-Path $env:ANDROID_HOME 'build-tools\37.0.0'
    $signer = & (Join-Path $tools 'apksigner.bat') verify --verbose --print-certs $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    $certificate = & (Join-Path $env:JAVA_HOME 'bin\keytool.exe') '-J-Duser.language=en' -list -v -keystore $env:TEF_ANDROID_KEYSTORE_PATH -storetype PKCS12 -storepass:env TEF_ANDROID_STORE_PASSWORD -alias $env:TEF_ANDROID_KEY_ALIAS
    if ($LASTEXITCODE -ne 0) { throw 'Release certificate verification failed.' }
    $apkDigest = [regex]::Match(($signer -join "`n"), 'certificate SHA-256 digest: ([a-fA-F0-9]+)').Groups[1].Value.ToUpperInvariant()
    $keyDigest = [regex]::Match(($certificate -join "`n"), 'SHA256: ([A-Fa-f0-9:]+)').Groups[1].Value.Replace(':','').ToUpperInvariant()
    if (!$apkDigest -or $apkDigest -ne $keyDigest) { throw 'APK does not match the approved local release certificate.' }
    $badging = & (Join-Path $tools 'aapt.exe') dump badging $apk
    if ($LASTEXITCODE -ne 0 -or ($badging -match 'application-debuggable')) { throw 'APK release manifest verification failed.' }
    $output = Join-Path $projectRoot 'release\android'
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    if ($FormalRelease) { Assert-CloudAcceptance }
    $artifactName = if ($FormalRelease) { 'tef-listening-0.1.0.apk' } else { 'tef-listening-cloud-setup-required.apk' }
    $destination = Join-Path $output $artifactName
    Copy-Item -LiteralPath $apk -Destination $destination
    if ($FormalRelease) {
        [ordered]@{
            artifact = $artifactName
            version = '0.1.0'
            sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
            bytes = (Get-Item -LiteralPath $destination).Length
            certificateSha256 = $apkDigest.ToLowerInvariant()
            signatureVerified = $true
            debuggable = $false
            freshGradleBuild = $true
            cloudAcceptanceSha256 = (Get-FileHash -LiteralPath $acceptancePath -Algorithm SHA256).Hash.ToLowerInvariant()
            emulatorVerified = $false
            ready = $false
        } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'release.json') -Encoding utf8
    }
} finally {
    Remove-Item Env:TEF_ANDROID_STORE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:TEF_ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue
}