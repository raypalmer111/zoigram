# Run after extracting the archive. Uses the Windows Documents known folder.
$ErrorActionPreference = 'Stop'
$sourceRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$manifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'mod_manifest.json') -Raw | ConvertFrom-Json
$modId = $manifest.ProjectName
if ($modId -notmatch '^InzoiSocial_[A-Z0-9]{6}$') { throw 'Invalid InzoiSocial mod id' }
$documents = [Environment]::GetFolderPath('MyDocuments')
if (-not $documents) { throw 'Windows Documents folder is unavailable' }
$modsRoot = [System.IO.Path]::GetFullPath((Join-Path $documents 'inZOI\Mods\InGame'))
$targetRoot = [System.IO.Path]::GetFullPath((Join-Path $modsRoot $modId))
if (-not $targetRoot.StartsWith($modsRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid destination' }
New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
if (-not $sourceRoot.Equals($targetRoot, [StringComparison]::OrdinalIgnoreCase)) {
    foreach ($entry in Get-ChildItem -LiteralPath $sourceRoot) {
        Copy-Item -LiteralPath $entry.FullName -Destination $targetRoot -Recurse -Force
    }
}
# Remove only the listed obsolete implementation files; photo and account files are excluded.
$obsoletePath = Join-Path $sourceRoot 'obsolete-files.json'
if (Test-Path -LiteralPath $obsoletePath -PathType Leaf) {
    foreach ($relative in (Get-Content -LiteralPath $obsoletePath -Raw | ConvertFrom-Json)) {
        if ($relative -notmatch '^(lua/[A-Za-z0-9_/]+\.lua|data/social-content\.ru\.json)$') { throw 'Unexpected obsolete file' }
        $obsoleteTarget = [System.IO.Path]::GetFullPath((Join-Path $targetRoot $relative))
        if (-not $obsoleteTarget.StartsWith($targetRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid obsolete path' }
        if (Test-Path -LiteralPath $obsoleteTarget -PathType Leaf) { Remove-Item -LiteralPath $obsoleteTarget -Force }
    }
}
$assetPath = (Join-Path $targetRoot 'assets\instagram-icon.png').Replace('\', '/')
if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) { throw 'Bundled icon is missing' }
$phoneEntryPath = Join-Path $targetRoot 'lua\B1\PhoneIntegration.lua'
$phoneEntry = [System.IO.File]::ReadAllText($phoneEntryPath)
$phoneEntry = $phoneEntry.Replace('__ASSET_PATH__', $assetPath.Replace("'", "\'"))
[System.IO.File]::WriteAllText($phoneEntryPath, $phoneEntry, [System.Text.UTF8Encoding]::new($false))
$manifest.bEnable = $true
[System.IO.File]::WriteAllText((Join-Path $targetRoot 'mod_manifest.json'), ($manifest | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))
Write-Output "Installed Zoigram in $targetRoot. Open the Zoi phone and choose Zoigram."
