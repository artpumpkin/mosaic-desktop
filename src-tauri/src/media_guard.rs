//! Accept only the operations offered by the media UI. Frontend arguments
//! must not become a general-purpose command line for Ghostscript/FFmpeg.
pub fn validate(
    tool: &str,
    args: &[String],
    suffix: &str,
    extension: Option<&str>,
) -> Result<(), String> {
    let simple = |s: &str| {
        s.len() <= 40
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    };
    if !simple(suffix) || extension.is_some_and(|e| e.is_empty() || !simple(e)) || args.len() > 40 {
        return Err("Invalid output filename or argument count".into());
    }
    if !matches!(tool, "ffmpeg" | "magick" | "gs" | "realesrgan-ncnn-vulkan") {
        return Err("This tool is not available for conversion jobs".into());
    }
    let mut i = 0;
    let mut inputs = 0;
    let mut outputs = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        if arg == "{input}" && matches!(tool, "magick" | "gs") {
            inputs += 1;
            i += 1;
            continue;
        }
        if arg == "{output}" && matches!(tool, "magick" | "ffmpeg") {
            outputs += 1;
            i += 1;
            continue;
        }
        if tool == "gs" {
            if arg == "-sOutputFile={output}" {
                outputs += 1;
            } else if !matches!(
                arg,
                "-sDEVICE=pdfwrite"
                    | "-dCompatibilityLevel=1.4"
                    | "-dPDFSETTINGS=/screen"
                    | "-dPDFSETTINGS=/ebook"
                    | "-dPDFSETTINGS=/printer"
                    | "-dPDFSETTINGS=/prepress"
                    | "-dNOPAUSE"
                    | "-dQUIET"
                    | "-dBATCH"
                    | "-dSAFER"
            ) {
                return Err("Unsupported PDF conversion option".into());
            }
            i += 1;
            continue;
        }
        if (tool == "ffmpeg" && matches!(arg, "-y" | "-vn" | "-nostats"))
            || (tool == "magick" && matches!(arg, "-strip" | "-auto-level" | "-enhance"))
        {
            i += 1;
            continue;
        }
        let value = args
            .get(i + 1)
            .ok_or("Missing conversion option value")?
            .as_str();
        let number = |min: f64, max: f64| {
            value
                .parse::<f64>()
                .is_ok_and(|v| v.is_finite() && v >= min && v <= max)
        };
        let safe = match (tool, arg) {
            ("ffmpeg" | "realesrgan-ncnn-vulkan", "-i") => {
                inputs += 1;
                value == "{input}"
            }
            ("realesrgan-ncnn-vulkan", "-o") => {
                outputs += 1;
                value == "{output}"
            }
            ("ffmpeg", "-c:v") => matches!(value, "libx264" | "libx265" | "libvpx-vp9"),
            ("ffmpeg", "-c:a") => matches!(
                value,
                "aac" | "libopus" | "libmp3lame" | "flac" | "pcm_s16le"
            ),
            ("ffmpeg", "-crf") => number(0.0, 51.0),
            ("ffmpeg", "-q:a") => number(0.0, 9.0),
            ("ffmpeg", "-b:a") => matches!(value, "128k" | "192k" | "256k" | "320k"),
            ("ffmpeg", "-preset") => matches!(value, "fast" | "medium" | "slow"),
            ("ffmpeg", "-tag:v") => value == "hvc1",
            ("ffmpeg", "-movflags") => value == "+faststart",
            ("ffmpeg", "-progress") => value == "pipe:1",
            ("ffmpeg", "-vf") => value
                .strip_prefix("scale=-2:")
                .is_some_and(|v| v.parse::<u32>().is_ok_and(|n| (1..=8192).contains(&n))),
            ("magick", "-quality") => number(1.0, 100.0),
            ("magick", "-density") => number(36.0, 600.0),
            ("magick", "-resize") => matches!(
                value,
                "75%" | "50%" | "25%" | "3840x3840>" | "1920x1920>" | "1280x1280>" | "800x800>"
            ),
            ("magick", "-define") => matches!(
                value,
                "png:compression-level=9" | "png:compression-filter=5"
            ),
            ("magick", "-sampling-factor") => value == "4:2:0",
            ("magick", "-interlace") => value == "JPEG",
            ("magick", "-sigmoidal-contrast") => value == "3x50%",
            ("magick", "-unsharp") => value == "0x1.2+1.0+0.02",
            ("magick", "-modulate") => value
                .strip_prefix("100,")
                .is_some_and(|v| v.parse::<u32>().is_ok_and(|n| (80..=150).contains(&n))),
            ("realesrgan-ncnn-vulkan", "-s") => number(2.0, 4.0),
            ("realesrgan-ncnn-vulkan", "-n") => matches!(
                value,
                "realesrgan-x4plus" | "realesrgan-x4plus-anime" | "realesr-animevideov3"
            ),
            ("realesrgan-ncnn-vulkan", "-m") => value == "{models}",
            _ => false,
        };
        if !safe {
            return Err(format!("Unsupported conversion option: {arg}"));
        }
        i += 2;
    }
    if inputs != 1 || outputs != 1 {
        return Err("A conversion requires exactly one input and output".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| (*s).into()).collect()
    }
    #[test]
    fn all_frontend_presets_pass_the_native_boundary() {
        let fixtures: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../../tests/media-presets.json")).unwrap();
        for fixture in fixtures {
            let tool = fixture["tool"].as_str().unwrap();
            let args: Vec<String> = serde_json::from_value(fixture["args"].clone()).unwrap();
            validate(
                tool,
                &args,
                fixture["outputSuffix"].as_str().unwrap(),
                fixture["outputExt"].as_str(),
            )
            .unwrap_or_else(|e| panic!("{tool}: {args:?}: {e}"));
        }
    }
    #[test]
    fn ordinary_conversions_are_supported() {
        assert!(validate(
            "magick",
            &args(&["{input}", "-quality", "80", "{output}"]),
            "compressed",
            Some("webp")
        )
        .is_ok());
        assert!(validate(
            "ffmpeg",
            &args(&[
                "-y",
                "-i",
                "{input}",
                "-c:v",
                "libx264",
                "-progress",
                "pipe:1",
                "{output}"
            ]),
            "",
            Some("mp4")
        )
        .is_ok());
    }
    #[test]
    fn rejects_file_and_process_escape_options() {
        for (tool, a) in [
            (
                "gs",
                args(&["-dNOSAFER", "-sOutputFile={output}", "{input}"]),
            ),
            (
                "magick",
                args(&["{input}", "-write", "/tmp/unselected", "{output}"]),
            ),
            ("ffmpeg", args(&["-i", "https://internal/", "{output}"])),
            (
                "ffmpeg",
                args(&["-i", "{input}", "-vf", "movie=/etc/passwd", "{output}"]),
            ),
            ("yt-dlp", args(&["--exec", "sh"])),
        ] {
            assert!(validate(tool, &a, "", Some("mp4")).is_err());
        }
        assert!(validate(
            "magick",
            &args(&["{input}", "{output}"]),
            "../escape",
            Some("png")
        )
        .is_err());
        assert!(validate(
            "magick",
            &args(&["{input}", "{output}"]),
            "",
            Some("../../escape")
        )
        .is_err());
    }
}
