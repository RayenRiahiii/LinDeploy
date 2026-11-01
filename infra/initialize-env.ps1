function Initialize-LinDeployEnvironment {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][System.Collections.IDictionary]$Defaults)
    $existing = if (Test-Path -LiteralPath $Path) { [IO.File]::ReadAllText($Path) } else { "" }
    $additions = [System.Collections.Generic.List[string]]::new()
    foreach ($name in @('DJANGO_SECRET_KEY', 'LINDEPLOY_CREDENTIAL_KEY')) {
        if ($existing -match "(?m)^\s*(?:export\s+)?$name\s*=") { continue }
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $value = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_')
        $additions.Add("$name=$value")
    }
    foreach ($name in $Defaults.Keys) {
        if ($existing -notmatch "(?m)^\s*(?:export\s+)?$([regex]::Escape($name))\s*=") {
            $additions.Add("$name=$($Defaults[$name])")
        }
    }
    if ($additions.Count -gt 0) {
        $prefix = if ($existing.Length -gt 0 -and -not $existing.EndsWith("`n")) { "`n" } else { "" }
        [IO.File]::AppendAllText($Path, $prefix + ($additions -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
    }
}
