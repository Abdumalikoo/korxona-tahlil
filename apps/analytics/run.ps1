# Tahlil xizmatini ishga tushirish (ishlab chiqish rejimi, o'zgarishda qayta yuklanadi)
Set-Location $PSScriptRoot
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
