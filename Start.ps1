$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
& python (Join-Path $root 'guide_extender.py') @args
if ($LASTEXITCODE -ne 0) { throw 'Guide extender exited with an error.' }
