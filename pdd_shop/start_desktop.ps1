$ErrorActionPreference = 'Stop'
$project = Join-Path (Split-Path $PSScriptRoot) 'pdd-app'
$exe = Join-Path $project 'apps\web\src-tauri\target\debug\app.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw 'MyShop Debug executable not found. Build the desktop app first.'
}

function Test-MyShopApi {
    try {
        return (Invoke-RestMethod 'http://127.0.0.1:3001/health' -TimeoutSec 3).ok -eq $true
    } catch {
        return $false
    }
}

if (-not (Test-MyShopApi)) {
    if (Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue) {
        throw 'Port 3001 is occupied and MyShop API is not responding.'
    }
    $npm = (Get-Command npm.cmd).Source
    Start-Process -FilePath $npm -ArgumentList 'run', 'dev:api' -WorkingDirectory $project -WindowStyle Hidden
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-MyShopApi) { break }
        Start-Sleep -Seconds 1
    }
    if (-not (Test-MyShopApi)) { throw 'MyShop API did not start on port 3001.' }
}

try {
    Invoke-RestMethod 'http://127.0.0.1:3001/api/trends/product-count' -TimeoutSec 8 | Out-Null
} catch {
    $mongo = Get-Service -Name MongoDB -ErrorAction SilentlyContinue
    if ($mongo -and $mongo.Status -eq 'Stopped') {
        Write-Warning 'MongoDB is stopped. Start MongoDB Server from Windows Services, then retry in MyShop.'
    } else {
        Write-Warning 'MyShop API is running, but the catalogue is unavailable. Check the API and database.'
    }
}

if (-not (Get-Process app -ErrorAction SilentlyContinue | Where-Object Path -eq $exe)) {
    Start-Process -FilePath $exe -WorkingDirectory $project
}
