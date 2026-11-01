$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../initialize-env.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('lindeploy-env-test-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
$path = Join-Path $testRoot '.env.docker'
$original = "# Preserve comments`r`nDJANGO_SECRET_KEY='existing=test'`r`nCUSTOM_VALUE=keep me`r`nBACKEND_PORT=9876"
[IO.File]::WriteAllText($path, $original, [Text.UTF8Encoding]::new($false))
Initialize-LinDeployEnvironment -Path $path -Defaults ([ordered]@{ BACKEND_PORT = 8000; DJANGO_DEBUG = 'False' })
$once = [IO.File]::ReadAllText($path)
if (-not $once.StartsWith($original)) { throw 'Existing configuration was rewritten.' }
if ($once -notmatch 'LINDEPLOY_CREDENTIAL_KEY=([A-Za-z0-9_-]{43}=)') { throw 'Missing valid dedicated key.' }
if ([Convert]::FromBase64String($Matches[1].Replace('-', '+').Replace('_', '/')).Length -ne 32) { throw 'Invalid key size.' }
Initialize-LinDeployEnvironment -Path $path -Defaults ([ordered]@{ BACKEND_PORT = 8000; DJANGO_DEBUG = 'False' })
if ([IO.File]::ReadAllText($path) -cne $once) { throw 'Second initialization changed the file.' }
$fresh = Join-Path $testRoot 'fresh.env'
Initialize-LinDeployEnvironment -Path $fresh -Defaults ([ordered]@{ DJANGO_DEBUG = 'False' })
$freshContent = [IO.File]::ReadAllText($fresh)
if ($freshContent -notmatch '(?m)^DJANGO_SECRET_KEY=([A-Za-z0-9_-]{43}=)$') { throw 'Missing signing key.' }
Write-Output 'PowerShell environment preservation and initialization: PASS'
# Only remove explicitly named files created by this test, never recurse.
Remove-Item -LiteralPath $path, $fresh
[IO.Directory]::Delete($testRoot)
