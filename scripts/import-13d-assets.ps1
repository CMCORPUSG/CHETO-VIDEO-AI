$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..\apps\desktop\src-tauri\resources\visual-13d'
$ui = @(
  'minimal/press', 'minimal/check', 'minimal/success', 'minimal/complete',
  'minimal/warning', 'minimal/error', 'minimal/cancel', 'minimal/open',
  'minimal/close', 'minimal/swipe', 'minimal/drop', 'minimal/snap',
  'minimal/send', 'minimal/typing', 'minimal/select', 'minimal/notification',
  'studio/achievement', 'studio/level-up', 'cinematic/swipe', 'cinematic/drop'
)
$soundkit = @(
  'buttons-and-navigation/button-1', 'buttons-and-navigation/tab-1',
  'buttons-and-navigation/expand', 'buttons-and-navigation/collapse',
  'complete-and-success/complete-1', 'complete-and-success/complete-2',
  'complete-and-success/success-1', 'complete-and-success/success-2',
  'errors-and-cancel/error-1', 'errors-and-cancel/cancel-1',
  'notifications-and-alerts/alert-1', 'notifications-and-alerts/notification-1'
)
$emoji = @('1f389','1f525','1f440','1f602','1f929','1f914','1f62e','1f44d','1f680','1f916','1f4a1','1f4af','1f3c6','1f6a8','1f4aa','1f60d')
function Save-ApprovedAsset([string]$url, [string]$relative) {
  $target = Join-Path $root $relative
  $folder = Split-Path $target -Parent
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  if (!(Test-Path -LiteralPath $target)) {
    Invoke-WebRequest -Uri $url -OutFile $target
  }
  if ((Get-Item -LiteralPath $target).Length -eq 0) { throw "Empty asset: $relative" }
}
foreach ($item in $ui) {
  Save-ApprovedAsset "https://raw.githubusercontent.com/romainsimon/uisfx/main/packages/uisfx/sounds/$item.mp3" "sfx/uisfx/$item.mp3"
}
foreach ($item in $soundkit) {
  Save-ApprovedAsset "https://raw.githubusercontent.com/thisuxhq/soundkit/main/low-volume-20db/$item.m4a" "sfx/soundkit/$item.m4a"
}
foreach ($item in $emoji) {
  Save-ApprovedAsset "https://fonts.gstatic.com/s/e/notoemoji/latest/$item/512.gif" "emoji/$item.gif"
}
Save-ApprovedAsset 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf' 'fonts/Inter.ttf'
Save-ApprovedAsset 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt' 'licenses/Inter-OFL.txt'
& python (Join-Path $PSScriptRoot 'generate-inter-weights.py')
if ($LASTEXITCODE -ne 0) { throw 'Could not generate fixed Inter weights. Install fonttools with: python -m pip install fonttools' }
Save-ApprovedAsset 'https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/InstrumentSerif-Italic.ttf' 'fonts/InstrumentSerif-Italic.ttf'
Save-ApprovedAsset 'https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/OFL.txt' 'licenses/InstrumentSerif-OFL.txt'
Save-ApprovedAsset 'https://raw.githubusercontent.com/romainsimon/uisfx/main/LICENSE-AUDIO' 'licenses/UISFX-AUDIO.txt'
Save-ApprovedAsset 'https://raw.githubusercontent.com/thisuxhq/soundkit/main/LICENSE' 'licenses/SoundKit-MIT.txt'
Write-Output "Downloaded $($ui.Count) UI SFX, $($soundkit.Count) SoundKit, $($emoji.Count) emoji and Inter."
