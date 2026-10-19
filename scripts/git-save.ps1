# ═══════════════════════════════════════════════════════════
# Hozirgi holatni Git'ga saqlash (commit).
#   powershell -ExecutionPolicy Bypass -File scripts\git-save.ps1 -Message "Qo'lda: hisobot sahifasi tuzatildi"
# O'zgarish bo'lmasa — hech narsa qilmaydi. .env va boshqa maxfiy fayllar .gitignore orqali chiqmaydi.
# ═══════════════════════════════════════════════════════════
param([string]$Message = "Qo'lda o'zgarishlar")
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  if (-not (Test-Path -LiteralPath ".git")) { Write-Host "Git yoqilmagan - avval git-migratsiya-boshlash.ps1" -ForegroundColor Red; exit 1 }
  git add -A 2>$null
  $staged = git diff --cached --name-only 2>$null
  if (-not $staged) { Write-Host "  Git: o'zgarish yo'q" -ForegroundColor DarkGray; exit 0 }
  $leak = $staged | Where-Object { $_ -match '(^|/)\.env($|\.)' -and $_ -notmatch '\.example$' }
  if ($leak) {
    git reset -q 2>$null
    Write-Host "TO'XTATILDI: maxfiy fayl commit'ga tushyapti: $($leak -join ', ') - .gitignore ni tekshiring" -ForegroundColor Red
    exit 1
  }
  git commit -q -m $Message 2>$null
  if ($LASTEXITCODE -ne 0) { Write-Host "git commit xato berdi" -ForegroundColor Red; exit 1 }
  $short = git rev-parse --short HEAD
  Write-Host "  Git: saqlandi $short - $Message ($(@($staged).Count) fayl)" -ForegroundColor Green
  exit 0
} finally {
  Pop-Location
}