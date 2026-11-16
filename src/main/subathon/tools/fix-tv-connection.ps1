# Steez - Subathon TV connection fixer for Windows 10/11
# Started from Steez (Subathon > Screens & links > Fix TV connection), which asks for admin rights.
# What it does:
#   1. Sets your Ethernet / Wi-Fi network to "Private" (Windows blocks other devices on "Public")
#   2. Removes Windows Firewall rules that silently block Steez (made when someone clicked
#      "Cancel" on the Windows firewall question)
#   3. Adds firewall rules that let your TV reach Steez
#   4. Warns about antivirus firewalls and two-router setups
#   5. Prints the exact address to type on your TV
param([int]$Port = 3000, [string]$Code = 'YOURCODE', [string]$AppPath = '')

$ErrorActionPreference = 'Continue'

function Title($t) { Write-Host ''; Write-Host "== $t ==" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "  [ OK ] $t" -ForegroundColor Green }
function Warn($t)  { Write-Host "  [ !! ] $t" -ForegroundColor Yellow }
function Bad($t)   { Write-Host "  [FAIL] $t" -ForegroundColor Red }
function Info($t)  { Write-Host "         $t" -ForegroundColor Gray }

Write-Host ''
Write-Host '  STEEZ - SUBATHON TV CONNECTION FIXER' -ForegroundColor White
Write-Host "  Port: $Port" -ForegroundColor DarkGray

# ------------------------------------------------------------------ admin check
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Bad 'This needs administrator rights. Close this window, click "Fix TV connection" in Steez again, then click Yes.'
  return
}

# ------------------------------------------------------------------ 1. network profile
Title '1. Network type (must be Private)'
$profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue)
if ($profiles.Count -eq 0) { Warn 'No active network found. Is the Ethernet cable plugged in?' }
foreach ($p in $profiles) {
  $label = "$($p.InterfaceAlias) ($($p.Name))"
  if ($p.NetworkCategory -eq 'Public') {
    try {
      Set-NetConnectionProfile -InterfaceIndex $p.InterfaceIndex -NetworkCategory Private -ErrorAction Stop
      Ok "$label changed from Public to Private"
    } catch {
      Bad "$label is Public and could not be changed: $($_.Exception.Message)"
    }
  } else {
    Ok "$label is $($p.NetworkCategory)"
  }
}

# ------------------------------------------------------------------ 2. firewall
Title '2. Windows Firewall'
$fw = Get-NetFirewallProfile -ErrorAction SilentlyContinue
if ($fw) { Info ('Firewall on for: ' + (($fw | Where-Object { $_.Enabled } | ForEach-Object { $_.Name }) -join ', ')) }

# Block rules always win over allow rules, so remove any that target Steez (or Node.js, from the old app)
$exeName = if ($AppPath) { Split-Path -Leaf $AppPath } else { 'Steez.exe' }
Info 'Looking for rules that block Steez (this can take a few seconds)...'
$blockRules = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue |
  Where-Object { $_.Program -like "*\$exeName" -or $_.Program -like '*node.exe' } |
  Get-NetFirewallRule -ErrorAction SilentlyContinue |
  Where-Object { $_.Action -eq 'Block' -and $_.Direction -eq 'Inbound' })
if ($blockRules.Count -gt 0) {
  foreach ($r in $blockRules) {
    try { Remove-NetFirewallRule -Name $r.Name -ErrorAction Stop; Ok "Removed blocking rule: $($r.DisplayName)" }
    catch { Bad "Could not remove blocking rule $($r.DisplayName): $($_.Exception.Message)" }
  }
} else {
  Ok 'No rules blocking Steez'
}

# Replace our own rules so running this twice doesn't pile up duplicates
Get-NetFirewallRule -DisplayName 'Steez Subathon*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
try {
  New-NetFirewallRule -DisplayName "Steez Subathon (port $Port)" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any -ErrorAction Stop | Out-Null
  Ok "Allowed incoming connections on port $Port"
} catch { Bad "Could not add port rule: $($_.Exception.Message)" }

if ($AppPath -and (Test-Path $AppPath)) {
  try {
    New-NetFirewallRule -DisplayName 'Steez Subathon (app)' -Direction Inbound -Program $AppPath -Action Allow -Profile Any -ErrorAction Stop | Out-Null
    Ok "Allowed Steez ($AppPath)"
  } catch { Bad "Could not add the Steez rule: $($_.Exception.Message)" }
}

# ------------------------------------------------------------------ 3. antivirus
Title '3. Other security software'
$third = @()
foreach ($cls in 'FirewallProduct', 'AntiVirusProduct') {
  $third += @(Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName $cls -ErrorAction SilentlyContinue |
    Where-Object { $_.displayName -notmatch 'Windows Defender|Microsoft Defender|Windows Firewall' } |
    ForEach-Object { $_.displayName })
}
$third = @($third | Sort-Object -Unique)
if ($third.Count -gt 0) {
  foreach ($name in $third) {
    Warn "$name is installed. It may have its OWN firewall that ignores the Windows settings above."
  }
  Info "If the TV still can't connect, open that program and allow Steez (or port $Port),"
  Info 'or turn its firewall off for one minute to test.'
} else {
  Ok 'Only Windows Security found (nothing else that could block it)'
}

# ------------------------------------------------------------------ 4. app + addresses
Title '4. The app and your addresses'
$listening = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listening.Count -gt 0) {
  Ok "The app is running on port $Port"
} else {
  Warn 'The TV & viewer server is NOT running. In Steez open Subathon > Screens & links and turn it on.'
}

$code = $Code

$configs = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue |
  Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' -and $_.InterfaceAlias -notmatch 'vEthernet|VirtualBox|VMware|Loopback|Bluetooth|Tailscale|ZeroTier' })
if ($configs.Count -eq 0) {
  Bad 'Could not find a connected Ethernet/Wi-Fi adapter with internet.'
}
$mainIp = $null
foreach ($c in $configs) {
  foreach ($a in @($c.IPv4Address)) {
    $ip = $a.IPAddress
    if (-not $ip -or $ip -like '169.254.*') { continue }
    if (-not $mainIp) { $mainIp = $ip }
    $gw = @($c.IPv4DefaultGateway)[0].NextHop
    $prefix = ($ip.Split('.')[0..2]) -join '.'
    Ok "$($c.InterfaceAlias): $ip   (router: $gw)"
    Info "Your TV and phone should get an address starting with $prefix."
  }
}

if ($mainIp -and $listening.Count -gt 0) {
  try {
    $r = Invoke-WebRequest -Uri "http://${mainIp}:$Port/api/public" -UseBasicParsing -TimeoutSec 4 -ErrorAction Stop
    if ($r.StatusCode -eq 200) { Ok "The app answers on http://${mainIp}:$Port" }
  } catch { Warn "The app did not answer on http://${mainIp}:$Port : $($_.Exception.Message)" }
}

if ($mainIp) {
  Write-Host ''
  Write-Host '  ------------------------------------------------------------' -ForegroundColor Magenta
  Write-Host '   TYPE THIS ON YOUR TV (Samsung "Internet" app):' -ForegroundColor White
  Write-Host ''
  Write-Host "   http://${mainIp}:$Port/tv/$code" -ForegroundColor Green
  Write-Host ''
  Write-Host "   Test it on your phone first (same Wi-Fi as the TV, not mobile data)." -ForegroundColor Gray
  Write-Host '  ------------------------------------------------------------' -ForegroundColor Magenta
}

Title 'If it STILL does not load on your phone/TV'
Info '* Check your phone''s IP (Wi-Fi settings > your network > details).'
if ($mainIp) { Info "  If it does NOT start with $((($mainIp.Split('.'))[0..2]) -join '.'), your PC and TV are on different routers." }
Info '  Fix: plug the PC into the router the Wi-Fi comes from, or set the second router/mesh'
Info '  to "Access Point" / "Bridge" mode.'
Info '* Make sure the TV is not on a GUEST Wi-Fi, and that "AP / client isolation" is off in your router.'
Info '* Or use the internet tunnel in Steez (Subathon > Screens & links) - it works no matter how your network is set up.'

Write-Host ''
Ok 'Done. You can close this window.'
Read-Host 'Press Enter to close'
