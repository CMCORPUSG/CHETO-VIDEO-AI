$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..\apps\desktop\src-tauri\resources\visual-13d'
$files = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -in @('.mp3','.m4a','.gif') } | Sort-Object FullName
$emojiNames = @{
  '1f389'='Celebración'; '1f3c6'='Trofeo'; '1f440'='Mirada'; '1f44d'='Aprobación';
  '1f4a1'='Idea'; '1f4aa'='Fuerza'; '1f4af'='Cien por ciento'; '1f525'='Fuego';
  '1f602'='Risa'; '1f60d'='Admiración'; '1f62e'='Sorpresa'; '1f680'='Cohete';
  '1f6a8'='Alerta'; '1f914'='Pensando'; '1f916'='Robot'; '1f929'='Asombro'
}
$items = foreach ($file in $files) {
  $relative = $file.FullName.Substring((Resolve-Path -LiteralPath $root).Path.Length + 1).Replace('\','/')
  $probe = & ffprobe -v error -show_format -show_streams -of json -- $file.FullName | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "FFprobe failed: $relative" }
  $isEmoji = $file.Extension -eq '.gif'
  $stream = $probe.streams | Where-Object { $_.codec_type -eq $(if ($isEmoji) {'video'} else {'audio'}) } | Select-Object -First 1
  if (!$stream) { throw "Missing stream: $relative" }
  $duration = [double]$(if ($probe.format.duration) {$probe.format.duration} else {$stream.duration})
  if ($duration -le 0) { throw "Missing duration: $relative" }
  $cue = $file.BaseName
  $provider = if ($isEmoji) {'Noto Animated Emoji'} elseif ($relative -match '^sfx/uisfx/') {'UI SFX'} else {'SoundKit'}
  $pack = if ($isEmoji) {'animated'} elseif ($provider -eq 'UI SFX') {($relative -split '/')[2]} else {'low-volume-20db'}
  $category = if ($isEmoji) {'Reacción'} elseif ($cue -match 'warning|alert') {'Warning'} elseif ($cue -match 'error') {'Error'} elseif ($cue -match 'complete') {'Complete'} elseif ($cue -match 'success') {'Success'} elseif ($cue -match 'check') {'Check'} elseif ($cue -match 'swipe') {'Transition'} else {'Interfaz'}
  $gain = if ($isEmoji) {0} elseif ($provider -eq 'SoundKit') {-4} elseif ($cue -match 'warning|error|achievement|level-up') {-13} else {-9}
  $sourceUrl = if ($isEmoji) {"https://fonts.gstatic.com/s/e/notoemoji/latest/$cue/512.gif"} elseif ($provider -eq 'UI SFX') {"https://github.com/romainsimon/uisfx"} else {"https://github.com/thisuxhq/soundkit"}
  [ordered]@{
    id = "builtin:$($provider.ToLower().Replace(' ','-')):$pack`:$cue"
    path = "visual-13d/$relative"
    name = if ($isEmoji) {"Emoji · $($emojiNames[$cue])"} else {($cue -replace '-',' ')}
    kind = if ($isEmoji) {'overlay'} else {'sfx'}
    format = $file.Extension.TrimStart('.')
    durationUs = [long][math]::Round($duration * 1000000)
    sampleRate = if ($isEmoji) {$null} else {[int]$stream.sample_rate}
    channels = if ($isEmoji) {$null} else {[int]$stream.channels}
    sizeBytes = [long]$file.Length
    modifiedMs = $null
    fingerprint = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLower()
    category = $category
    tags = if ($isEmoji) {@($cue, $pack, $category.ToLower(), $emojiNames[$cue].ToLower())} else {@($cue, $pack, $category.ToLower())}
    favorite = $false
    source = $provider
    author = if ($provider -eq 'SoundKit') {'THISUX Private Limited'} elseif ($isEmoji) {'Google LLC'} else {'UI SFX'}
    license = if ($isEmoji) {'CC BY 4.0'} elseif ($provider -eq 'UI SFX') {'CC0-1.0'} else {'MIT'}
    sourceUrl = $sourceUrl
    commercialUse = $true
    attributionRequired = $isEmoji -or $provider -eq 'SoundKit'
    notes = 'Recurso incluido para uso offline.'
    loopable = $isEmoji
    createdAt = '2026-09-28T00:00:00Z'
    origin = 'builtin'
    repository = if ($isEmoji) {'googlefonts/noto-emoji-animation'} elseif ($provider -eq 'UI SFX') {'romainsimon/uisfx'} else {'thisuxhq/soundkit'}
    pack = $pack
    cue = $cue
    defaultGainDb = $gain
  }
}
$json = ConvertTo-Json -InputObject @($items) -Depth 8
$target = Join-Path $root 'manifest.json'
[System.IO.File]::WriteAllText($target, $json, [System.Text.UTF8Encoding]::new($false))
Write-Output "Manifest: $($items.Count) assets -> $target"
