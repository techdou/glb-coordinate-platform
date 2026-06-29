# ============================================================
#  通用 3D 坐标采集工具 —— PowerShell 启动（向后兼容入口）
#
#  本脚本现已委托给跨平台 Python 脚本 scripts/start.py。
#  参数透传：-Port / -NoBrowser / -Host（见 start.py）
# ============================================================
param(
  [int]$Port = 8000,
  [switch]$NoBrowser,
  [string]$BindHost = $null
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$startPy = Join-Path $scriptRoot "start.py"

if (-not (Test-Path -LiteralPath $startPy)) {
  throw "找不到 $startPy"
}

# 构造传给 start.py 的参数
$pyArgs = @("scripts/start.py", "--port", $Port)
if ($NoBrowser) { $pyArgs += "--no-browser" }
if ($BindHost)  { $pyArgs += @("--host", $BindHost) }

# 选择 Python 解释器：优先 py 启动器
$pythonCmd = $null
foreach ($cmd in @("py", "python", "python3")) {
  $found = Get-Command $cmd -ErrorAction SilentlyContinue
  if ($found) { $pythonCmd = $cmd; break }
}
if (-not $pythonCmd) {
  throw "未找到 Python。请安装 Python 3.6 以上版本：https://www.python.org/downloads/"
}

# 在项目根目录执行（start.py 内部自行定位 app/）
$projectRoot = Split-Path -Parent $scriptRoot
Push-Location -LiteralPath $projectRoot
try {
  & $pythonCmd @pyArgs
} finally {
  Pop-Location
}
