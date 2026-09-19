$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'studio.py'
if (Get-Command python -ErrorAction SilentlyContinue) {
    & python $scriptPath @args
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 $scriptPath @args
} else {
    throw 'Python 3.11 or newer is required.'
}
exit $LASTEXITCODE
