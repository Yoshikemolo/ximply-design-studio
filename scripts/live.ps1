$ErrorActionPreference = 'Stop'
& python (Join-Path $PSScriptRoot 'live.py') @args
exit $LASTEXITCODE
