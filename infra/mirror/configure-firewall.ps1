param(
    [string]$LanSubnet = "192.168.100.0/24"
)

$ErrorActionPreference = "Stop"
$Principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $ScriptPath = $MyInvocation.MyCommand.Path
    $ArgumentList = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$ScriptPath`"",
        "-LanSubnet", "`"$LanSubnet`""
    )
    $Process = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList $ArgumentList
    exit $Process.ExitCode
}

$Rules = @(
    @{
        Name = "LinDeploy Mirror OCI"
        Ports = "5001-5003"
    },
    @{
        Name = "LinDeploy Mirror Artifacts"
        Ports = "8443"
    }
)

foreach ($Rule in $Rules) {
    $Existing = Get-NetFirewallRule -DisplayName $Rule.Name -ErrorAction SilentlyContinue
    if ($Existing) {
        Set-NetFirewallRule `
            -DisplayName $Rule.Name `
            -Enabled True `
            -Direction Inbound `
            -Action Allow `
            -Profile Private
        Set-NetFirewallAddressFilter -AssociatedNetFirewallRule $Existing -RemoteAddress $LanSubnet
        Set-NetFirewallPortFilter -AssociatedNetFirewallRule $Existing -Protocol TCP -LocalPort $Rule.Ports
    }
    else {
        New-NetFirewallRule `
            -DisplayName $Rule.Name `
            -Direction Inbound `
            -Action Allow `
            -Profile Private `
            -Protocol TCP `
            -LocalPort $Rule.Ports `
            -RemoteAddress $LanSubnet | Out-Null
    }
    Write-Host "$($Rule.Name): allowed from $LanSubnet"
}
