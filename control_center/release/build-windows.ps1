param([switch] $RequireSigning)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$controlCenterRoot = Join-Path $repositoryRoot "control_center"
$productName = "Anote Control Center"
$pyInstallerVersion = "6.21.0"
$buildRoot = Join-Path $controlCenterRoot "build\windows-packaging"
$venvPath = Join-Path $buildRoot ".venv"
$venvPython = Join-Path $venvPath "Scripts\python.exe"
$distPath = Join-Path $controlCenterRoot "dist"
$appPath = Join-Path $distPath $productName
$executablePath = Join-Path $appPath "$productName.exe"
$installerPath = Join-Path $distPath "Anote-Control-Center-Windows11-x64-Setup.exe"
$versionFile = Join-Path $buildRoot "version-info.txt"
$runtimeCompose = Join-Path $controlCenterRoot "src\anote_control_center\runtime\compose.yaml"
$bootstrapPython = Get-Command python -CommandType Application -ErrorAction Stop |
    Select-Object -First 1 -ExpandProperty Source

$readVersion = "import pathlib,sys,tomllib; print(tomllib.loads(pathlib.Path(sys.argv[1]).read_text())['project']['version'])"
$packageVersion = [string] (& $bootstrapPython -c $readVersion (Join-Path $controlCenterRoot "pyproject.toml"))
if ($LASTEXITCODE -ne 0) { throw "Could not read the Control Center version." }
$packageVersion = $packageVersion.Trim()
if ($packageVersion -notmatch '^\d+\.\d+\.\d+$') { throw "Control Center version must have three numeric components." }
$parts = $packageVersion.Split('.')
$tuple = "$($parts[0]), $($parts[1]), $($parts[2]), 0"

New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
New-Item -ItemType Directory -Path $distPath -Force | Out-Null
$metadata = @"
VSVersionInfo(ffi=FixedFileInfo(filevers=($tuple), prodvers=($tuple), mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0,0)), kids=[StringFileInfo([StringTable(u'040904B0',[StringStruct(u'CompanyName',u'Anote'),StringStruct(u'FileDescription',u'$productName'),StringStruct(u'FileVersion',u'$packageVersion.0'),StringStruct(u'InternalName',u'$productName'),StringStruct(u'OriginalFilename',u'$productName.exe'),StringStruct(u'ProductName',u'$productName'),StringStruct(u'ProductVersion',u'$packageVersion')])]),VarFileInfo([VarStruct(u'Translation',[1033,1200])])])
"@
[System.IO.File]::WriteAllText($versionFile, $metadata, [System.Text.UTF8Encoding]::new($false))

if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    & $bootstrapPython -m venv $venvPath
    if ($LASTEXITCODE -ne 0) { throw "Could not create the packaging environment." }
}
& $venvPython -m pip install --disable-pip-version-check "pyinstaller==$pyInstallerVersion"
if ($LASTEXITCODE -ne 0) { throw "Could not install pinned PyInstaller." }
& $venvPython -c 'import tkinter; assert tkinter.TkVersion >= 8.6'
if ($LASTEXITCODE -ne 0) { throw "Python does not provide Tk 8.6." }
& $venvPython -m PyInstaller --noconfirm --clean --onedir --windowed `
    --name $productName `
    --version-file $versionFile `
    --contents-directory "_internal" `
    --distpath $distPath `
    --workpath (Join-Path $buildRoot "pyinstaller") `
    --specpath (Join-Path $buildRoot "pyinstaller") `
    --paths (Join-Path $controlCenterRoot "src") `
    --add-data "$runtimeCompose;anote_control_center/runtime" `
    (Join-Path $controlCenterRoot "src\anote_control_center\app.py")
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $executablePath -PathType Leaf)) { throw "PyInstaller did not produce the executable." }

$privateFiles = @(Get-ChildItem -LiteralPath $appPath -Recurse -File | Where-Object {
    $_.Name -match '\.anote-(release|checkpoint)$|\.db$|^production\.env$|^installation\.json$|^journal\.json$|\.tar$'
})
if ($privateFiles.Count -ne 0) { throw "The payload-free application contains runtime or production material." }

$signTool = [string] $env:WINDOWS_SIGNTOOL_PATH
$thumbprint = ([string] $env:WINDOWS_SIGN_CERTIFICATE_SHA1).Replace(" ", "")
$timestamp = [string] $env:WINDOWS_SIGN_TIMESTAMP_URL
$configured = -not [string]::IsNullOrWhiteSpace($signTool) -and -not [string]::IsNullOrWhiteSpace($thumbprint) -and -not [string]::IsNullOrWhiteSpace($timestamp)
if ($RequireSigning -and -not $configured) { throw "Required Windows signing is not fully configured." }
if ($configured) {
    if (-not (Test-Path -LiteralPath $signTool -PathType Leaf) -or $thumbprint -notmatch '^[A-Fa-f0-9]{40}$' -or $timestamp -notmatch '^https://') { throw "Windows signing configuration is invalid." }
    & $signTool sign /fd SHA256 /sha1 $thumbprint /tr $timestamp /td SHA256 $executablePath
    if ($LASTEXITCODE -ne 0) { throw "Executable signing failed." }
} else {
    Write-Warning "Producing an unsigned Windows Control Center installer."
}

$check = Start-Process -FilePath $executablePath -ArgumentList "--self-check" -PassThru
if (-not $check.WaitForExit(60000)) {
    Stop-Process -Id $check.Id -Force -ErrorAction SilentlyContinue
    throw "The packaged executable self-check timed out."
}
$check.Refresh()
if ($check.ExitCode -ne 0) { throw "The packaged executable failed its self-check." }
$iscc = @(
    (Get-Command ISCC.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
    (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe")
    (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $iscc) { throw "Inno Setup 6 is required." }
& $iscc "/DProductVersion=$packageVersion" "/DSourceDirectory=$appPath" "/DOutputDirectory=$distPath" (Join-Path $PSScriptRoot "control-center.iss")
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw "Inno Setup did not produce the installer." }
if ($configured) {
    & $signTool sign /fd SHA256 /sha1 $thumbprint /tr $timestamp /td SHA256 $installerPath
    if ($LASTEXITCODE -ne 0) { throw "Installer signing failed." }
    & $signTool verify /pa /v $installerPath
    if ($LASTEXITCODE -ne 0) { throw "Installer signature verification failed." }
}
Write-Output $installerPath
