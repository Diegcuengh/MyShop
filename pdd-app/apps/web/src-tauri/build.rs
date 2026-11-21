use std::{fs, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=../dist");
    let state = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("desktop-build-version.txt");
    let count = fs::read_to_string(&state).ok().and_then(|s| s.trim().parse::<u32>().ok()).unwrap_or(0) + 1;
    fs::write(&state, count.to_string()).expect("cannot save desktop build version");
    let output = Command::new("powershell.exe").args(["-NoProfile", "-Command", "Get-Date -Format 'yyyy-MM-dd/HH:mm:ss'"]).output().expect("cannot determine build time");
    assert!(output.status.success(), "cannot determine build time");
    let time = String::from_utf8(output.stdout).expect("invalid build time");
    let version = format!("v0.{}.{}/{}", count / 10, count % 10, time.trim());
    println!("cargo:rustc-env=MYSHOP_BUILD_INFO={version}");
    println!("cargo:warning=MyShop {version}");
    tauri_build::build()
}
