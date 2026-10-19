# ═══════════════════════════════════════════════════════════
# Baza o'zgarishi -> migratsiya (prisma db push o'rniga).
#   powershell -ExecutionPolicy Bypass -File scripts\db-migrate.ps1 -Name ombor_holati
# 1) packages\db\prisma\schema.prisma bilan hozirgi baza solishtiriladi;
# 2) farq SQL ko'rinishida migrations\<vaqt>_<nom>\migration.sql ga yoziladi;
# 3) ma'lumot o'chirishi mumkin bo'lgan buyruq (DROP, turini o'zgartirish) bo'lsa — to'xtaydi
#    (ataylab bo'lsa: -AllowDestructive);
# 4) prisma migrate deploy — bazaga qo'llanadi, prisma generate — klient yangilanadi.
# Serverda (Hetzner) faqat: cd packages\db ; npx prisma migrate deploy
# Natija kodi: 0 — tayyor yoki o'zgarish yo'q, 1 — xato (baza o'zgarmagan).
# ═══════════════════════════════════════════════════════════
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [switch]$AllowDestructive
)
$ErrorActionPreference = "Continue"
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8

$root = Split-Path -Parent $PSScriptRoot
$db = Join-Path $root "packages\db"
if (-not (Test-Path -LiteralPath (Join-Path $db "prisma\migrations\migration_lock.toml"))) {
  Write-Host "Migratsiyalar yoqilmagan (prisma\migrations yo'q) - avval git-migratsiya-boshlash.ps1 ni ishga tushiring" -ForegroundColor Red
  exit 1
}
$slug = ($Name.ToLower() -replace '[^a-z0-9]+', '_').Trim('_')
if (-not $slug) { $slug = "ozgarish" }

Push-Location $db
try {
  # 1. Farq bormi?
  npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code *> $null
  $code = $LASTEXITCODE
  if ($code -eq 0) {
    Write-Host "  Baza sxema bilan bir xil - yangi migratsiya kerak emas" -ForegroundColor DarkGray
    exit 0
  }
  if ($code -ne 2) {
    Write-Host "Bazaga ulanib bo'lmadi (prisma migrate diff xato) - PostgreSQL ishlayotganini va packages\db\.env dagi DATABASE_URL ni tekshiring" -ForegroundColor Red
    exit 1
  }

  # 2. SQL
  $lines = & npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script 2>$null
  $started = $false
  $sqlLines = foreach ($l in $lines) {
    if (-not $started -and $l -match '^\s*(--|CREATE|ALTER|DROP|BEGIN)') { $started = $true }
    if ($started) { $l }
  }
  $sql = ($sqlLines -join "`n").Trim()
  if (-not $sql) { Write-Host "Farq bor, lekin SQL olinmadi - prisma chiqishini tekshiring" -ForegroundColor Red; exit 1 }

  Write-Host ""
  Write-Host "  Bazaga qo'llanadigan o'zgarish:" -ForegroundColor Cyan
  foreach ($l in ($sql -split "`n")) { if ($l -notmatch '^\s*$') { Write-Host "    $l" -ForegroundColor Gray } }
  Write-Host ""

  # 3. Xavfli buyruqlar
  $danger = [regex]::Matches($sql, '(?im)^\s*(DROP\s+(TABLE|COLUMN|TYPE|SCHEMA)\b|ALTER\s+TABLE[^\n;]*\bDROP\s+COLUMN\b|(ALTER\s+TABLE[^\n;]*)?ALTER\s+COLUMN[^\n;]*\bTYPE\b|TRUNCATE\b|DELETE\s+FROM\b)')
  if ($danger.Count -gt 0 -and -not $AllowDestructive) {
    Write-Host "TO'XTATILDI: o'zgarishda ma'lumot o'chirishi mumkin bo'lgan buyruq bor (DROP / turini o'zgartirish)." -ForegroundColor Red
    Write-Host "Baza o'zgarmadi. Ataylab bo'lsa: -AllowDestructive bilan qayta ishga tushiring (avval baza zaxirasini oling)." -ForegroundColor Red
    exit 1
  }

  # 4. Fayl va qo'llash
  $stamp = Get-Date -Format "yyyyMMddHHmmss"
  $dir = Join-Path $db "prisma\migrations\$($stamp)_$slug"
  [void][IO.Directory]::CreateDirectory($dir)
  [IO.File]::WriteAllText((Join-Path $dir "migration.sql"), $sql + "`n", $utf8)
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) {
    Remove-Item -Recurse -Force -LiteralPath $dir
    Write-Host "prisma migrate deploy xato berdi - migratsiya fayli olib tashlandi. Xato yozuvini yuboring" -ForegroundColor Red
    exit 1
  }
  npx prisma generate
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Migratsiya qo'llandi, lekin prisma generate xato berdi - node jarayonlari to'xtatilganini tekshirib, packages\db da 'npx prisma generate' ni qayta ishga tushiring" -ForegroundColor Yellow
  }
  Write-Host "  Migratsiya qo'llandi: prisma\migrations\$($stamp)_$slug" -ForegroundColor Green
  exit 0
} finally {
  Pop-Location
}