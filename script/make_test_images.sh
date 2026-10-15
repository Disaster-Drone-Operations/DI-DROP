#!/usr/bin/env bash
# Generates test images in the style of a DJI M4TD SD card:
#   <target>/DCIM/DJI_<date>_001_<name>/DJI_<time>_<no>_{W,Z,T}.JPG
# incl. EXIF (time, GPS, camera) and DJI XMP (gimbal, altitude …).
#
#   script/make_test_images.sh <target folder> [start time HHMM] [count]
# Requires: ImageMagick (magick) and exiftool

set -euo pipefail
target="${1:?specify target folder}"
start="${2:-1430}"
count="${3:-4}"
day=$(date +%Y%m%d)
dir="$target/DCIM/DJI_${day}${start}_001_Test"
mkdir -p "$dir"

for i in $(seq 1 "$count"); do
  minute=$(( 10#${start:2:2} + i - 1 ))
  stamp="${day}${start:0:2}$(printf %02d $minute)$(printf %02d $((i * 7 % 60)))"
  nr=$(printf %04d "$i")
  base="$dir/DJI_${stamp}_${nr}"
  exif_time="${stamp:0:4}:${stamp:4:2}:${stamp:6:2} ${stamp:8:2}:${stamp:10:2}:${stamp:12:2}"
  yaw=$(( (i * 37) % 360 - 180 ))
  lat="50.70$((10 + i))"; lon="10.72$((60 + i))"

  magick -size 4000x3000 gradient:'#4a6b3a'-'#9bb07a' -fill white -pointsize 200 -gravity center \
    -annotate 0 "Shot $i\nWide" -quality 85 "${base}_W.JPG"
  magick -size 4000x3000 gradient:'#6b5a3a'-'#c9b48a' -fill white -pointsize 200 -gravity center \
    -annotate 0 "Shot $i\nZoom" -quality 85 "${base}_Z.JPG"
  magick -size 640x512 plasma:'#200040'-'#ffcc00' -seed "$i" -fill white -pointsize 48 -gravity center \
    -annotate 0 "Shot $i\nThermal" -quality 90 "${base}_T.JPG"

  for v in W Z T; do
    zoom=1; [ "$v" = Z ] && zoom=7
    exiftool -q -overwrite_original \
      -Make=DJI -Model=M4TD \
      "-DateTimeOriginal=$exif_time" "-CreateDate=$exif_time" \
      -GPSLatitude="$lat" -GPSLatitudeRef=N -GPSLongitude="$lon" -GPSLongitudeRef=E \
      "-XMP-drone-dji:AbsoluteAltitude=+$((800 + i))" "-XMP-drone-dji:RelativeAltitude=+80.0" \
      "-XMP-drone-dji:GimbalYawDegree=$yaw" "-XMP-drone-dji:GimbalPitchDegree=-45.0" \
      "-XMP-drone-dji:FlightYawDegree=$yaw" "-DigitalZoomRatio=$zoom" \
      "${base}_${v}.JPG"
  done
done
echo "$count shots (W/Z/T each) in $dir"
