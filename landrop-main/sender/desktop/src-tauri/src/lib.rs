mod application;
pub mod protocol;

#[tauri::command]
fn get_desktop_info() -> application::DesktopInfo {
    application::desktop_info()
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_desktop_info])
        .run(tauri::generate_context!())
        .expect("LanDrop Desktop could not start");
}
