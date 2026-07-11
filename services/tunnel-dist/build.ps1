# Cross-compiles the tunnel server + client into ./dist for distribution.
# Run from anywhere: pwsh services/tunnel-dist/build.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$agent = Resolve-Path (Join-Path (Join-Path $here '..') 'agent')
$dist = Join-Path $here 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null

$targets = @(
  @{ os = 'linux';   arch = 'amd64'; ext = '' },
  @{ os = 'linux';   arch = 'arm64'; ext = '' },
  @{ os = 'windows'; arch = 'amd64'; ext = '.exe' }
)

Push-Location $agent
try {
  $env:CGO_ENABLED = '0'
  foreach ($t in $targets) {
    $env:GOOS = $t.os
    $env:GOARCH = $t.arch
    foreach ($cmd in @('tunnel-server', 'tunnel-client')) {
      $name = "$cmd-$($t.os)-$($t.arch)$($t.ext)"
      Write-Host "building $name"
      go build -trimpath -ldflags '-s -w' -o (Join-Path $dist $name) "./cmd/$cmd"
    }
  }
}
finally {
  Pop-Location
  Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue
}

Write-Host "`nArtifacts in ${dist}:"
Get-ChildItem $dist | Format-Table Name, @{ N = 'MB'; E = { [math]::Round($_.Length / 1MB, 2) } } -AutoSize
