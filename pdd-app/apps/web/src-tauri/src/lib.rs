use std::{io::{BufRead, BufReader, Write}, net::{SocketAddr, TcpStream}, path::Path, process::{Child, Command, Stdio}, sync::Mutex, time::{Duration, Instant}};
use tauri::{Emitter, Manager, State};

#[derive(Default)]
struct MerchantBrowser(Mutex<Option<Child>>);

fn local_port_ready(port: u16) -> bool {
  let address = SocketAddr::from(([127, 0, 0, 1], port));
  TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

fn start_local_service(script: &Path, directory: &Path, arguments: &[&str]) -> Result<(), String> {
  if !script.is_file() {
    return Err(format!("找不到本地服务文件：{}", script.display()));
  }
  let mut command = Command::new("node");
  command.arg(script).args(arguments).current_dir(directory)
    .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
  if directory.file_name().is_some_and(|name| name == "api") {
    command.env("PORT", "43121");
  }
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
  }
  command.spawn().map_err(|error| format!("无法启动本地服务，请检查 Node.js：{error}"))?;
  Ok(())
}

fn ensure_local_services() -> Result<(), String> {
  let desktop = Path::new(env!("CARGO_MANIFEST_DIR"));
  let web = desktop.parent().ok_or("无法找到前端目录")?;
  let apps = web.parent().ok_or("无法找到应用目录")?;
  let root = apps.parent().ok_or("无法找到项目目录")?;
  if !local_port_ready(43121) {
    start_local_service(&root.join("node_modules/tsx/dist/cli.mjs"), &apps.join("api"), &["src/server.ts"])?;
  }
  if !local_port_ready(5173) {
    start_local_service(&root.join("node_modules/vite/bin/vite.js"), web, &["--host", "127.0.0.1", "--port", "5173", "--strictPort"])?;
  }
  let deadline = Instant::now() + Duration::from_secs(20);
  while Instant::now() < deadline {
    if local_port_ready(5173) && local_port_ready(43121) { return Ok(()); }
    std::thread::sleep(Duration::from_millis(200));
  }
  Err("本地服务启动超时，请检查 Node.js、项目依赖及端口。".into())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
  let parsed = url::Url::parse(&url).map_err(|_| "商品链接无效".to_string())?;
  if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
    return Err("只允许打开 HTTP 或 HTTPS 链接".into());
  }
  #[cfg(windows)]
  {
    use std::os::windows::ffi::OsStrExt;
    let target: Vec<u16> = std::ffi::OsStr::new(parsed.as_str()).encode_wide().chain(Some(0)).collect();
    let result = unsafe { windows_sys::Win32::UI::Shell::ShellExecuteW(std::ptr::null_mut(), std::ptr::null(), target.as_ptr(), std::ptr::null(), std::ptr::null(), 1) };
    if (result as isize) <= 32 { return Err("无法打开系统浏览器".into()); }
    Ok(())
  }
  #[cfg(not(windows))]
  { Err("当前系统暂不支持打开外部浏览器".into()) }
}

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
  if cfg!(debug_assertions) {
    if let Err(error) = ensure_local_services() {
      eprintln!("MyShop {}: {error}", env!("MYSHOP_BUILD_INFO"));
    }
  }
  tauri::Builder::default()
    .manage(MerchantBrowser::default())
    .invoke_handler(tauri::generate_handler![open_merchant_browser, prepare_merchant_product, open_external_url])
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
