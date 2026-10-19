$ErrorActionPreference = 'Stop'
$key = ((Get-Content .\.env | Where-Object { $_ -match '^\s*ANALYTICS_KEY\s*=' }) -split '=', 2)[1].Trim().Trim('"')
$h = @{ 'X-Analytics-Key' = $key }
$base = 'http://127.0.0.1:8001'
$start = '2026-01'; $end = '2026-07'

"=== HEALTH ==="
Invoke-RestMethod "$base/health" -Headers $h -TimeoutSec 20 | ConvertTo-Json -Depth 5

"=== PANEL (birinchi 5 qator) ==="
$p = Invoke-RestMethod "$base/panel?start=$start&end=$end" -Headers $h -TimeoutSec 30
"Qatorlar: $($p.rows.Count)"
$p.rows | Select-Object -First 5 | Format-Table period, region_code, region_name, expense_total, expense_payroll, expense_lease, headcount -AutoSize | Out-String

$tests = @(
  @{ id = 'growth';        body = @{ start = $start; end = $end; metric = 'expense_total' } },
  @{ id = 'share';         body = @{ start = $start; end = $end; metric = 'expense_total'; groupBy = 'type' } },
  @{ id = 'share';         body = @{ start = $start; end = $end; metric = 'expense_total'; groupBy = 'region' } },
  @{ id = 'per_employee';  body = @{ start = $start; end = $end; metric = 'expense_total' } },
  @{ id = 'payroll_ratio'; body = @{ start = $start; end = $end } },
  @{ id = 'hhi';           body = @{ start = $start; end = $end; metric = 'expense_total' } },
  @{ id = 'volatility';    body = @{ start = $start; end = $end; metric = 'expense_total' } },
  @{ id = 'correlation';   body = @{ start = $start; end = $end; metric = 'expense_total'; metric2 = 'headcount' } }
)

foreach ($t in $tests) {
  "=== $($t.id) $($t.body.groupBy) ==="
  try {
    $r = Invoke-RestMethod "$base/formulas/$($t.id)/run" -Method Post -Headers $h `
      -ContentType 'application/json' -Body ($t.body | ConvertTo-Json) -TimeoutSec 60
    "Vaqt: $($r.tookMs) ms"
    "Stats:"
    $r.result.stats | ConvertTo-Json -Depth 4
    "Xulosa: $($r.result.interpretation)"
    if ($r.result.warnings) { "Ogohlantirish: $($r.result.warnings -join ' | ')" }
  } catch {
    "XATO: $($_.Exception.Message)"
    if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message }
  }
  ""
}