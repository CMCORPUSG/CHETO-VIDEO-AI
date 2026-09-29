param(
  [string]$SourcePath,
  [int[]]$Durations = @(10, 30)
)

$ErrorActionPreference = 'Stop'
$benchmarkDir = Join-Path $env:TEMP 'cheto-export-benchmark'
New-Item -ItemType Directory -Force -Path $benchmarkDir | Out-Null
if (-not $SourcePath) {
  $SourcePath = Join-Path $benchmarkDir 'synthetic-30s.mp4'
  & ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=1280x720:rate=30' -f lavfi -i 'sine=frequency=440:sample_rate=48000' -t 30 -c:v libx264 -preset ultrafast -crf 22 -c:a aac -b:a 128k $SourcePath
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la fuente sintética.' }
}
if (-not (Test-Path -LiteralPath $SourcePath)) { throw "Fuente no encontrada: $SourcePath" }
$dimensions = (& ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 $SourcePath).Trim().Split(',')
if ($dimensions.Length -lt 2) { throw 'FFprobe no encontró una pista de video.' }
$width = [int]$dimensions[0]
$height = [int]$dimensions[1]

function Measure-Export([string]$label, [string[]]$arguments) {
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  & ffmpeg -hide_banner -loglevel error -y @arguments 2>&1 | Out-Null
  $watch.Stop()
  if ($LASTEXITCODE -ne 0) { throw "FFmpeg falló durante $label" }
  [pscustomobject]@{ Pipeline = $label; Seconds = [math]::Round($watch.Elapsed.TotalSeconds, 3) }
}

$results = @()
foreach ($duration in $Durations) {
  $output = Join-Path $benchmarkDir "render-$duration.mp4"
  $remux = Join-Path $benchmarkDir "remux-$duration.mp4"
  $base = @('-i', $SourcePath, '-t', "$duration")
  $videoEncode = @('-c:v', 'libx264', '-preset', 'medium', '-b:v', '5M', '-pix_fmt', 'yuv420p')
  $audioEncode = @('-c:a', 'aac', '-b:a', '192k')
  $camera = "crop=iw/1.2:ih/1.2,scale=${width}:${height}"
  $cut = "select='not(between(t,2,3))',setpts=N/FRAME_RATE/TB"
  $audioCut = "aselect='not(between(t,2,3))',asetpts=N/SR/TB"
  $rows = @(
    (Measure-Export 'DEMUX/DECODE' ($base + @('-map','0:v:0','-an','-f','null','NUL'))),
    (Measure-Export 'VIDEO FILTERS + CAMERA/CROP/SCALE' ($base + @('-map','0:v:0','-an','-vf',$camera,'-f','null','NUL'))),
    (Measure-Export 'AUDIO FILTERS' ($base + @('-map','0:a:0','-vn','-af','volume=1.5,lowpass=f=12000','-f','null','NUL'))),
    (Measure-Export 'ENCODE (sin archivo)' ($base + @('-map','0:v:0','-an') + $videoEncode + @('-f','null','NUL'))),
    (Measure-Export 'SOURCE ONLY' ($base + @('-map','0:v:0','-map','0:a:0') + $videoEncode + $audioEncode + @($output))),
    (Measure-Export 'CUT' ($base + @('-map','0:v:0','-map','0:a:0','-vf',$cut,'-af',$audioCut) + $videoEncode + $audioEncode + @($output))),
    (Measure-Export 'CAMERA' ($base + @('-map','0:v:0','-map','0:a:0','-vf',$camera) + $videoEncode + $audioEncode + @($output))),
    (Measure-Export 'CAMERA + AUDIO' ($base + @('-map','0:v:0','-map','0:a:0','-vf',$camera,'-af','volume=1.5,lowpass=f=12000') + $videoEncode + $audioEncode + @($output))),
    (Measure-Export 'MUX + DISK I/O (stream copy)' ($base + @('-map','0:v:0','-map','0:a:0','-c','copy',$remux)))
  )
  $copyWatch = [System.Diagnostics.Stopwatch]::StartNew()
  Copy-Item -LiteralPath $remux -Destination (Join-Path $benchmarkDir "disk-copy-$duration.mp4") -Force
  $copyWatch.Stop()
  $rows += [pscustomobject]@{ Pipeline = 'DISK I/O (copia de archivo)'; Seconds = [math]::Round($copyWatch.Elapsed.TotalSeconds, 3) }
  foreach ($row in $rows) { $results += [pscustomobject]@{ SampleSeconds = $duration; Pipeline = $row.Pipeline; Seconds = $row.Seconds; RealtimeFactor = [math]::Round($duration / [math]::Max($row.Seconds, 0.001), 2) } }
}
$results | Format-Table -AutoSize
Write-Output "Resultados temporales: $benchmarkDir"
