# Per-Raspberry Pi SSH Kiosk & Watchdog Provisioner for Fleet & TV Display
# Examples:
#   .\deploy-pi.ps1 list
#   .\deploy-pi.ps1 inspect breakroom
#   .\deploy-pi.ps1 deploy breakroom
#   .\deploy-pi.ps1 status breakroom
#   .\deploy-pi.ps1 restart breakroom
#   .\deploy-pi.ps1 rollback breakroom

$ErrorActionPreference = "Stop"
$tsxCmd = Join-Path $PSScriptRoot "node_modules\.bin\tsx.cmd"
$scriptPath = Join-Path $PSScriptRoot "scripts\pi-deploy\deploy-pi.ts"

& $tsxCmd $scriptPath @args
exit $LASTEXITCODE
