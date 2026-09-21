<#
.SYNOPSIS
Publishes the built editor to the production host and points the site at it.

.DESCRIPTION
Builds the application from the current checkout, uploads it to a directory named after
the commit it was built from, and moves the symbolic link the web server reads. The
previous releases are kept, so a return to the one before is a move of that link. The
web server is only reloaded after it accepts its own configuration, and the sites that
share the host are checked before and after, so a release that breaks a neighbour is
visible at once.

.EXAMPLE
pwsh scripts/deploy-production.ps1
Builds, runs the tests, uploads and publishes.

.EXAMPLE
pwsh scripts/deploy-production.ps1 -Rollback
Points the site back at the release published before the current one.
#>
[CmdletBinding()]
param(
    [string]$Server = '72.62.239.94',
    [string]$User = 'root',
    [string]$IdentityFile = "$HOME/.ssh/id_deploy",
    [string]$Domain = 'xds.ximplicity.es',
    [string]$SiteRoot = '/var/www/xds.ximplicity.es',
    [string[]]$Neighbours = @('evidentapp.ai', 'www.evidentapp.ai', 'api.ximplicity.es'),
    [int]$KeepReleases = 5,
    [string]$NodeVersion = '24.15.0',
    [switch]$SkipTests,
    [switch]$AllowDirty,
    [switch]$Rollback
)

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
Set-Location $repository

function Write-Step([string]$message) {
    Write-Host ''
    Write-Host "== $message" -ForegroundColor Cyan
}

function Invoke-Remote([string]$command) {
    # What the host writes to its error stream is joined to its output there, not here:
    # Windows PowerShell turns a native command's error stream into failures of its own,
    # and a command such as nginx -t writes to it even when it is content.
    $output = & ssh -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=20 -i $IdentityFile "$User@$Server" "{ $command ; } 2>&1"
    if ($LASTEXITCODE -ne 0) {
        throw "The host refused the command: $command`n$output"
    }
    return $output
}

function Get-SiteStatus([string[]]$names) {
    $script = ($names | ForEach-Object { "printf '%s %s\n' '$_' `"`$(curl -s -o /dev/null -w 'http=%{http_code}' -m 15 https://$_/)`"" }) -join '; '
    return (Invoke-Remote $script) -join "`n"
}

Write-Step "Checking the host $Server"
$null = Invoke-Remote 'true'

if ($Rollback) {
    Write-Step 'Returning to the release published before the current one'
    $current = (Invoke-Remote "readlink $SiteRoot/current").Trim()
    $previous = (Invoke-Remote "ls -1dt $SiteRoot/releases/*/ | sed -n 2p").Trim().TrimEnd('/')
    if (-not $previous) { throw 'There is no earlier release on the host to return to.' }
    Write-Host "Current:  $current"
    Write-Host "Previous: $previous"
    $before = Get-SiteStatus (@($Domain) + $Neighbours)
    $null = Invoke-Remote "ln -sfn $previous $SiteRoot/current && nginx -t && systemctl reload nginx"
    Start-Sleep -Seconds 2
    $after = Get-SiteStatus (@($Domain) + $Neighbours)
    Write-Host "`nBefore:`n$before`n`nAfter:`n$after"
    Write-Host "`nThe site now serves $previous" -ForegroundColor Green
    exit 0
}

Write-Step 'Checking the checkout'
$dirty = & git status --porcelain
if ($dirty -and -not $AllowDirty) {
    throw "The checkout carries changes that are not committed, so the release could not be traced back to a commit. Commit them, or pass -AllowDirty to publish anyway.`n$($dirty -join "`n")"
}
$commit = (& git rev-parse --short HEAD).Trim()
$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Write-Host "Branch $branch, commit $commit, version $version"

if (-not $SkipTests) {
    Write-Step 'Running the tests'
    & npx vitest run
    if ($LASTEXITCODE -ne 0) { throw 'The tests did not pass, so nothing was published.' }
}

Write-Step "Building the application with Node $NodeVersion"
# The build runs on the Node the Angular compiler accepts, whatever the shell has.
& npx -y "node@$NodeVersion" node_modules/@angular/cli/bin/ng.js build --configuration production
if ($LASTEXITCODE -ne 0) { throw 'The build failed, so nothing was published.' }
$build = Join-Path $repository 'dist/studio/browser'
if (-not (Test-Path (Join-Path $build 'index.html'))) { throw "The build left no index.html in $build." }

Write-Step 'Reading how the sites answer before the release'
$before = Get-SiteStatus (@($Domain) + $Neighbours)
Write-Host $before

Write-Step "Uploading the build as $commit"
$release = "$SiteRoot/releases/$commit"
$null = Invoke-Remote "rm -rf $release.incoming && mkdir -p $release.incoming"
# The build travels as one stream, so a half-written directory is never published.
$archive = Join-Path ([System.IO.Path]::GetTempPath()) "xds-$commit.tar.gz"
& tar -czf $archive -C $build .
if ($LASTEXITCODE -ne 0) { throw 'The build could not be packed.' }
& scp -q -o BatchMode=yes -o IdentitiesOnly=yes -i $IdentityFile $archive "${User}@${Server}:$release.tar.gz"
if ($LASTEXITCODE -ne 0) { throw 'The build could not be copied to the host.' }
Remove-Item $archive -Force
$null = Invoke-Remote "tar -xzf $release.tar.gz -C $release.incoming && rm -f $release.tar.gz && rm -rf $release && mv $release.incoming $release && chown -R www-data:www-data $release"

Write-Step 'Publishing the release'
$null = Invoke-Remote "ln -sfn $release $SiteRoot/current && nginx -t"
$null = Invoke-Remote 'systemctl reload nginx'
Start-Sleep -Seconds 2

Write-Step 'Checking the release'
$page = Invoke-Remote "curl -s -o /dev/null -w '%{http_code}' -m 20 https://$Domain/"
if ("$page".Trim() -ne '200') { throw "The site answered $page after the release. Return to the release before it with -Rollback." }
$asset = Invoke-Remote "curl -s -m 20 https://$Domain/ | grep -o 'main-[A-Z0-9]*\.js' | head -1"
$assetStatus = Invoke-Remote "curl -s -o /dev/null -w '%{http_code}' -m 20 https://$Domain/$($asset -join '')"
if ("$assetStatus".Trim() -ne '200') { throw "The application code answered $assetStatus. Return to the release before it with -Rollback." }
$after = Get-SiteStatus (@($Domain) + $Neighbours)
Write-Host $after
if ($before -ne $after) {
    Write-Warning "The sites do not answer as they did before the release. Before:`n$before`nAfter:`n$after"
}

Write-Step 'Tidying older releases'
$null = Invoke-Remote "cd $SiteRoot/releases && ls -1dt */ | tail -n +$($KeepReleases + 1) | xargs -r rm -rf"
$kept = (Invoke-Remote "ls -1dt $SiteRoot/releases/*/ | sed 's#.*/releases/##;s#/##'") -join ', '

Write-Host ''
Write-Host "Published $version from $branch at $commit on https://$Domain/" -ForegroundColor Green
Write-Host "Releases kept on the host: $kept"
Write-Host 'Return to the release before it with: pwsh scripts/deploy-production.ps1 -Rollback'
