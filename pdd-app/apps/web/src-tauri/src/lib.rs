use std::{io::{BufRead, BufReader, Write}, process::{Child, Command, Stdio}, sync::Mutex};
use tauri::{Emitter, Manager, State};

#[derive(Default)]
struct MerchantBrowser(Mutex<Option<Child>>);

fn send_browser_message(app: &tauri::AppHandle, browser: &MerchantBrowser, message: serde_json::Value) -> Result<(), String> {
  let mut guard = browser.0.lock().map_err(|e| e.to_string())?;
  let needs_start = match guard.as_mut() {
    Some(child) => child.try_wait().map_err(|e| e.to_string())?.is_some(),
    None => true,
  };
  if needs_start {
    if !cfg!(debug_assertions) {
      return Err("Browser automation is not yet bundled for release".into());
    }
    let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("merchant-browser.mjs");
    let mut command = Command::new("node");
    command.arg(script).env("MYSHOP_BUILD_INFO", env!("MYSHOP_BUILD_INFO"))
      .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
    #[cfg(windows)]
    {
      use std::os::windows::process::CommandExt;
      command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| format!("Cannot start local browser: {e}"))?;
    let stdout = child.stdout.take().ok_or("Cannot read browser status")?;
    let handle = app.clone();
    std::thread::spawn(move || {
      let mut closed_normally = false;
      for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
          closed_normally = event.get("closed").and_then(|value| value.as_bool()).unwrap_or(false);
          let _ = handle.emit("merchant-status", event);
        }
      }
      if !closed_normally {
        let _ = handle.emit("merchant-status", serde_json::json!({
          "message": "商家浏览器启动失败或意外退出；请检查 Chrome 和 Node.js 后重试。",
          "isError": true,
          "state": "error"
        }));
      }
    });
    *guard = Some(child);
  }
  let stdin = guard.as_mut().and_then(|child| child.stdin.as_mut()).ok_or("Browser process is not available")?;
  writeln!(stdin, "{message}").and_then(|_| stdin.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_merchant_browser(app: tauri::AppHandle, browser: State<'_, MerchantBrowser>) -> Result<(), String> {
  send_browser_message(&app, &browser, serde_json::json!({"type": "open"}))
}

#[tauri::command]
fn prepare_merchant_product(app: tauri::AppHandle, browser: State<'_, MerchantBrowser>, product: serde_json::Value) -> Result<(), String> {
  send_browser_message(&app, &browser, serde_json::json!({"type": "prepare", "product": product}))
}

pub fn run() {
  tauri::Builder::default()
    .manage(MerchantBrowser::default())
    .invoke_handler(tauri::generate_handler![open_merchant_browser, prepare_merchant_product])
    .setup(|app| {
      let build_info = env!("MYSHOP_BUILD_INFO");
      println!("MyShop {build_info}");
      if let Some(window) = app.get_webview_window("main") {
        window.set_title(&format!("MyShop {build_info}"))?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
