$ErrorActionPreference = 'Stop'
& python (Join-Path $PSScriptRoot 'local.py') @args
exit $LASTEXITCODE
