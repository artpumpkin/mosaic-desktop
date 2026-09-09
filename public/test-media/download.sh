#!/bin/sh
# Generate only synthetic test media; retained script name for compatibility.
set -eu
cd "$(dirname "$0")"
ffmpeg -y -f lavfi -i 'testsrc2=size=640x360:rate=30' -t 10 -c:v libx264 -pix_fmt yuv420p -b:v 800k bbb-10s-1mb.mp4
ffmpeg -y -f lavfi -i 'testsrc2=size=1920x1080:rate=30' -t 10 -c:v libx264 -pix_fmt yuv420p -b:v 24M bbb-10s-30mb.mp4
ffmpeg -y -f lavfi -i 'testsrc2=size=1280x720:rate=30' -f lavfi -i 'sine=frequency=440:sample_rate=48000' -t 10 -c:v libx264 -pix_fmt yuv420p -c:a aac sintel-trailer-720.mp4
ffmpeg -y -f lavfi -i 'testsrc2=size=1280x720:rate=30' -f lavfi -i 'sine=frequency=440:sample_rate=48000' -t 10 -c:v libx264 -pix_fmt yuv420p -c:a aac -ac 2 sintel-trailer.mp4
