param(
  [string]$BaseUrl = "http://127.0.0.1:3000",
  [int]$MaxItems = 15,
  [int]$RetryCount = 1,
  [int]$ItemTimeoutMs = 300000,
  [int]$HumanDelayMinMs = 0,
  [int]$HumanDelayMaxMs = 5000,
  [bool]$EnableDownload = $true,
  [int]$Layer2PollSeconds = 5,
  [int]$Layer2WaitTimeoutSeconds = 1800
)

$ErrorActionPreference = "Stop"

function Write-Log {
  param([string]$Message)
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$ts] $Message"
}

function Write-SummaryLine {
  param(
    [string]$SummaryPath,
    [string]$L1Status,
    [string]$L2Status,
    [string]$Note
  )

  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "$ts | L1=$L1Status | L2=$L2Status"
  if ($Note) {
    $line += " | $Note"
  }
  Add-Content -Path $SummaryPath -Value $line -Encoding UTF8
}

function Wait-Layer2Completion {
  param(
    [string]$BaseUrl,
    [string]$ExpectedRunId,
    [int]$PollSeconds,
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $status = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/eojn/v1/layer2/status" -TimeoutSec 60
    $active = [bool]($status.active)
    $runId = [string]($status.run_id)
    $phase = [string]($status.phase)
    $message = [string]($status.message)

    if ($runId -eq $ExpectedRunId -and -not $active) {
      return @{
        ok = $true
        phase = $phase
        message = $message
        status = $status
      }
    }

    if ((Get-Date) -ge $deadline) {
      throw "Layer 2 wait timeout. run_id=$ExpectedRunId phase=$phase message=$message"
    }

    Start-Sleep -Seconds $PollSeconds
  } while ($true)
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot "out\eojn_v1\_scheduler_logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir ("eojn_cycle_" + (Get-Date -Format "yyyy_MM_dd_HHmmss") + ".log")
$summaryPath = Join-Path $logDir "eojn_cycle_summary.log"

$l1Status = "NOT_RUN"
$l2Status = "NOT_RUN"
$summaryNote = ""

Start-Transcript -Path $logPath -Force | Out-Null
try {
  Write-Log "Checking backend health at $BaseUrl/health"
  $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/health" -TimeoutSec 30
  if (-not $health -or $health.status -ne "ok") {
    throw "Backend health check failed."
  }

  $layer1Body = @{
    mode = "incremental"
    dry_run = $false
  } | ConvertTo-Json

  Write-Log "Starting EOJN Layer 1 incremental run"
  $layer1 = Invoke-RestMethod `
    -Method Post `
    -Uri "$BaseUrl/api/eojn/v1/run" `
    -ContentType "application/json" `
    -Body $layer1Body `
    -TimeoutSec 900
  $l1Status = "SUCCESS"

  Write-Log ("Layer 1 completed. active_cycle_run_date=" + [string]($layer1.active_cycle.run_date_ymd))

  $layer2Body = @{
    max_items = $MaxItems
    retry_count = $RetryCount
    item_timeout_ms = $ItemTimeoutMs
    enable_download = $EnableDownload
    human_delay_min_ms = $HumanDelayMinMs
    human_delay_max_ms = $HumanDelayMaxMs
  } | ConvertTo-Json

  Write-Log "Starting EOJN Layer 2 run"
  $layer2 = Invoke-RestMethod `
    -Method Post `
    -Uri "$BaseUrl/api/eojn/v1/layer2/start" `
    -ContentType "application/json" `
    -Body $layer2Body `
    -TimeoutSec 120

  Write-Log ("Layer 2 accepted. run_id=" + [string]($layer2.run_id))
  Write-Log "Waiting for Layer 2 completion"
  $layer2Done = Wait-Layer2Completion `
    -BaseUrl $BaseUrl `
    -ExpectedRunId ([string]$layer2.run_id) `
    -PollSeconds $Layer2PollSeconds `
    -TimeoutSeconds $Layer2WaitTimeoutSeconds

  $finalPhase = [string]($layer2Done.phase)
  if ($finalPhase -eq "DONE") {
    $l2Status = "SUCCESS"
  }
  else {
    $l2Status = "FAIL"
  }
  $summaryNote = "run_id=" + [string]($layer2.run_id) + "; phase=" + $finalPhase + "; " + [string]($layer2Done.message)

  Write-Log ("Layer 2 completed. phase=" + $finalPhase)
  Write-Log ("Log saved to " + $logPath)
}
catch {
  if ($l1Status -eq "NOT_RUN") {
    $l1Status = "FAIL"
    $l2Status = "NOT_RUN"
  }
  elseif ($l2Status -eq "NOT_RUN") {
    $l2Status = "FAIL"
  }
  $summaryNote = $_.Exception.Message
  Write-Log ("Scheduler cycle failed: " + $_.Exception.Message)
  throw
}
finally {
  Write-SummaryLine -SummaryPath $summaryPath -L1Status $l1Status -L2Status $l2Status -Note $summaryNote
  Stop-Transcript | Out-Null
}
