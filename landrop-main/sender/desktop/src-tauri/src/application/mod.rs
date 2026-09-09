use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct DesktopInfo {
    pub name: &'static str,
    pub version: &'static str,
}

pub fn desktop_info() -> DesktopInfo {
    DesktopInfo {
        name: "LanDrop Desktop",
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[cfg(test)]
mod tests {
    use super::desktop_info;

    #[test]
    fn identifies_the_desktop_application() {
        let info = desktop_info();
        assert_eq!(info.name, "LanDrop Desktop");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert!(!info.version.is_empty());
    }
}
