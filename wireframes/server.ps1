$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 4173
$outLog = Join-Path $baseDir "server-out.log"
$errLog = Join-Path $baseDir "server-err.log"
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $port)

$contentTypes = @{
  ".css" = "text/css; charset=utf-8"
  ".html" = "text/html; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg" = "image/svg+xml"
  ".txt" = "text/plain; charset=utf-8"
  ".png" = "image/png"
  ".jpg" = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".woff" = "font/woff"
  ".woff2" = "font/woff2"
}

function Send-Response {
  param(
    [System.Net.Sockets.TcpClient]$Client,
    [int]$StatusCode,
    [string]$StatusText,
    [byte[]]$Body,
    [string]$ContentType = "text/plain; charset=utf-8"
  )

  $stream = $Client.GetStream()
  $headers = @(
    "HTTP/1.1 $StatusCode $StatusText",
    "Content-Type: $ContentType",
    "Cache-Control: no-store",
    "Content-Length: $($Body.Length)",
    "Connection: close",
    "",
    ""
  ) -join "`r`n"

  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($Body.Length -gt 0) {
    $stream.Write($Body, 0, $Body.Length)
  }
  $stream.Flush()
}

"" | Set-Content $outLog
"" | Set-Content $errLog

function Write-ServerLog {
  param([string]$Message)
  Add-Content -Path $outLog -Value $Message
}

function Write-ServerError {
  param([string]$Message)
  Add-Content -Path $errLog -Value $Message
}

Write-Host "Wireframe server running at http://127.0.0.1:$port/"
Write-ServerLog "Wireframe server starting at http://127.0.0.1:$port/ from $baseDir"
$listener.Start()

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()

    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()

      while (($line = $reader.ReadLine()) -ne $null -and $line -ne "") {
      }

      if ([string]::IsNullOrWhiteSpace($requestLine)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Bad request")
        Send-Response -Client $client -StatusCode 400 -StatusText "Bad Request" -Body $body
        continue
      }

      $parts = $requestLine.Split(" ")
      if ($parts.Length -lt 2) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Bad request")
        Send-Response -Client $client -StatusCode 400 -StatusText "Bad Request" -Body $body
        continue
      }

      $relativePath = [Uri]::UnescapeDataString(($parts[1].Split("?")[0]).TrimStart("/"))
      if ([string]::IsNullOrWhiteSpace($relativePath)) {
        $relativePath = "chat-wireframes.html"
      }

      $targetPath = [System.IO.Path]::GetFullPath((Join-Path $baseDir $relativePath))
      if (-not $targetPath.StartsWith($baseDir, [System.StringComparison]::OrdinalIgnoreCase)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Forbidden")
        Send-Response -Client $client -StatusCode 403 -StatusText "Forbidden" -Body $body
        continue
      }

      if ((Test-Path $targetPath) -and (Get-Item $targetPath).PSIsContainer) {
        $targetPath = Join-Path $targetPath "chat-wireframes.html"
      }

      if (-not (Test-Path $targetPath)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Not found")
        Send-Response -Client $client -StatusCode 404 -StatusText "Not Found" -Body $body
        continue
      }

      $extension = [System.IO.Path]::GetExtension($targetPath).ToLowerInvariant()
      $contentType = $contentTypes[$extension]
      if (-not $contentType) {
        $contentType = "application/octet-stream"
      }

      $bytes = [System.IO.File]::ReadAllBytes($targetPath)
      Send-Response -Client $client -StatusCode 200 -StatusText "OK" -Body $bytes -ContentType $contentType
    }
    finally {
      $client.Close()
    }
  }
}
catch {
  Write-ServerError ($_ | Out-String)
  throw
}
finally {
  try {
    $listener.Stop()
    Write-ServerLog "Wireframe server stopped"
  }
  catch {
    Write-ServerError ($_ | Out-String)
  }
}
