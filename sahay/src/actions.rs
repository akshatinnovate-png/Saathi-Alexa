#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub fn width(&self) -> i32 {
        (self.right - self.left).max(1)
    }
    pub fn height(&self) -> i32 {
        (self.bottom - self.top).max(1)
    }
    pub fn center(&self) -> (i32, i32) {
        (self.left + self.width() / 2, self.top + self.height() / 2)
    }
}

pub fn to_screen(screen: Rect, x: f64, y: f64) -> (i32, i32) {
    let clamp = |v: f64| if v.is_finite() { v.clamp(0.0, 1000.0) } else { 500.0 };
    let px = screen.left + ((clamp(x) / 1000.0) * f64::from(screen.width() - 1)).round() as i32;
    let py = screen.top + ((clamp(y) / 1000.0) * f64::from(screen.height() - 1)).round() as i32;
    (px, py)
}

pub fn to_normalized(screen: Rect, px: i32, py: i32) -> (i32, i32) {
    let x = (f64::from(px - screen.left) / f64::from(screen.width() - 1).max(1.0) * 1000.0).round() as i32;
    let y = (f64::from(py - screen.top) / f64::from(screen.height() - 1).max(1.0) * 1000.0).round() as i32;
    (x.clamp(0, 1000), y.clamp(0, 1000))
}

pub fn vk(name: &str) -> Option<u16> {
    let n = name.trim().to_ascii_lowercase();
    let code = match n.as_str() {
        "ctrl" | "control" => 0x11,
        "shift" => 0x10,
        "alt" | "menu" => 0x12,
        "win" | "windows" | "meta" | "super" | "cmd" => 0x5B,
        "enter" | "return" => 0x0D,
        "esc" | "escape" => 0x1B,
        "tab" => 0x09,
        "space" | "spacebar" => 0x20,
        "backspace" | "back" => 0x08,
        "delete" | "del" => 0x2E,
        "insert" | "ins" => 0x2D,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" | "page_up" | "pgup" => 0x21,
        "pagedown" | "page_down" | "pgdn" => 0x22,
        "up" | "arrowup" => 0x26,
        "down" | "arrowdown" => 0x28,
        "left" | "arrowleft" => 0x25,
        "right" | "arrowright" => 0x27,
        "capslock" => 0x14,
        "printscreen" | "prtsc" => 0x2C,
        "volumeup" | "volume_up" => 0xAF,
        "volumedown" | "volume_down" => 0xAE,
        "mute" | "volumemute" => 0xAD,
        "playpause" | "play_pause" | "mediaplaypause" => 0xB3,
        "nexttrack" | "next_track" => 0xB0,
        "prevtrack" | "previous_track" => 0xB1,
        "plus" => 0xBB,
        "minus" => 0xBD,
        "comma" => 0xBC,
        "period" | "dot" => 0xBE,
        "slash" => 0xBF,
        "semicolon" => 0xBA,
        "quote" => 0xDE,
        "backslash" => 0xDC,
        "bracketleft" => 0xDB,
        "bracketright" => 0xDD,
        "backquote" | "grave" => 0xC0,
        "contextmenu" | "apps" => 0x5D,
        _ => {
            let chars: Vec<char> = n.chars().collect();
            if chars.len() == 1 {
                let c = chars[0];
                if c.is_ascii_alphanumeric() {
                    return Some(c.to_ascii_uppercase() as u16);
                }
                return match c {
                    '+' | '=' => Some(0xBB),
                    '-' => Some(0xBD),
                    ',' => Some(0xBC),
                    '.' => Some(0xBE),
                    '/' => Some(0xBF),
                    ';' => Some(0xBA),
                    '\'' => Some(0xDE),
                    '\\' => Some(0xDC),
                    '[' => Some(0xDB),
                    ']' => Some(0xDD),
                    '`' => Some(0xC0),
                    _ => None,
                };
            }
            if let Some(num) = n.strip_prefix('f').and_then(|d| d.parse::<u16>().ok()) {
                if (1..=24).contains(&num) {
                    return Some(0x6F + num);
                }
            }
            return None;
        }
    };
    Some(code)
}

pub fn parse_combo(keys: &str) -> Result<Vec<u16>, String> {
    let text = keys.trim();
    if text.is_empty() {
        return Err("No keys given".into());
    }
    let parts: Vec<&str> = if text == "+" { vec!["+"] } else { text.split('+').map(str::trim).filter(|p| !p.is_empty()).collect() };
    parts.iter().map(|p| vk(p).ok_or_else(|| format!("Unknown key \"{p}\""))).collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct Element {
    pub id: usize,
    pub kind: String,
    pub name: String,
    pub value: String,
    pub rect: Rect,
    pub enabled: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect { left: 0, top: 0, right: 1920, bottom: 1080 };

    #[test]
    fn normalized_points_land_on_the_right_pixels_and_back() {
        assert_eq!(to_screen(SCREEN, 0.0, 0.0), (0, 0));
        assert_eq!(to_screen(SCREEN, 1000.0, 1000.0), (1919, 1079));
        assert_eq!(to_screen(SCREEN, 500.0, 500.0), (960, 540));
        assert_eq!(to_screen(SCREEN, -40.0, f64::NAN), (0, 540));
        let second = Rect { left: 1920, top: 0, right: 3840, bottom: 1080 };
        assert_eq!(to_screen(second, 0.0, 0.0), (1920, 0));
        assert_eq!(to_normalized(SCREEN, 960, 540), (500, 500));
    }

    #[test]
    fn shortcuts_are_parsed_into_virtual_keys() {
        assert_eq!(parse_combo("ctrl+l").unwrap(), vec![0x11, 0x4C]);
        assert_eq!(parse_combo("Ctrl + Shift + T").unwrap(), vec![0x11, 0x10, 0x54]);
        assert_eq!(parse_combo("win+r").unwrap(), vec![0x5B, 0x52]);
        assert_eq!(parse_combo("alt+f4").unwrap(), vec![0x12, 0x73]);
        assert_eq!(parse_combo("enter").unwrap(), vec![0x0D]);
        assert_eq!(parse_combo("page_down").unwrap(), vec![0x22]);
        assert_eq!(parse_combo("+").unwrap(), vec![0xBB]);
        assert!(parse_combo("ctrl+banana").is_err());
        assert!(parse_combo("").is_err());
    }
}
