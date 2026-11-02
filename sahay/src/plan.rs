#[derive(Debug, Clone, PartialEq)]
pub enum Aim {
    Id(String),
    Point(f64, f64),
    Words(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    Open(String),
    Click { aim: Aim, button: &'static str, double: bool },
    Hover(Aim),
    Type(String),
    Key { keys: String, times: u32 },
    Scroll { up: bool, sideways: bool, amount: i32, at: Option<Aim> },
    Drag(Aim, Aim),
    Wait(f64),
    WaitFor(String),
    Focus(String),
    Run(String),
    Clipboard,
    Saathi { tool: String, args: String },
}

impl Step {
    pub fn reports(&self) -> bool {
        matches!(self, Step::Run(_) | Step::Clipboard | Step::Saathi { .. })
    }
}

fn unquote(s: &str) -> String {
    let t = s.trim();
    let t = t.strip_prefix(':').unwrap_or(t).trim();
    let q: &[char] = &['"', '\'', '“', '”', '{', '}', '[', ']'];
    t.trim_matches(q).trim().to_string()
}

pub fn aim(text: &str) -> Option<Aim> {
    let t = unquote(text);
    if t.is_empty() {
        return None;
    }
    let bare = t.trim_start_matches('#').trim_start_matches('@');
    let mut chars = bare.chars();
    if matches!(chars.next(), Some('E' | 'e' | 'T' | 't')) && bare.len() > 1 && bare[1..].chars().all(|c| c.is_ascii_digit()) {
        return Some(Aim::Id(bare.to_ascii_uppercase()));
    }
    let coords: Vec<&str> = bare.split([',', ' ']).filter(|p| !p.is_empty()).collect();
    if coords.len() == 2 {
        if let (Ok(x), Ok(y)) = (coords[0].parse::<f64>(), coords[1].parse::<f64>()) {
            if x.is_finite() && y.is_finite() {
                return Some(Aim::Point(x.clamp(0.0, 1000.0), y.clamp(0.0, 1000.0)));
            }
        }
    }
    Some(Aim::Words(t))
}

fn split_verb(line: &str) -> (String, String) {
    let line = line.trim().trim_start_matches(|c: char| c.is_ascii_digit() || c == '.' || c == ')' || c == '-' || c == '*').trim();
    let end = line.find(|c: char| c.is_whitespace() || c == ':').unwrap_or(line.len());
    (line[..end].to_ascii_lowercase(), line[end..].trim().trim_start_matches(':').trim().to_string())
}

pub fn parse(line: &str) -> Result<Step, String> {
    let (verb, rest) = split_verb(line);
    let need = |what: &str| if rest.trim().is_empty() { Err(format!("\"{}\" needs {what}", line.trim())) } else { Ok(()) };
    let target = || aim(&rest).ok_or_else(|| format!("\"{}\" needs a target", line.trim()));
    Ok(match verb.as_str() {
        "open" | "go" | "launch" | "start" => {
            need("something to open")?;
            Step::Open(unquote(&rest))
        }
        "click" | "tap" | "press_on" => Step::Click { aim: target()?, button: "left", double: false },
        "double" | "doubleclick" | "double_click" | "dblclick" => Step::Click { aim: target()?, button: "left", double: true },
        "right" | "rightclick" | "right_click" => Step::Click { aim: target()?, button: "right", double: false },
        "hover" | "move" => Step::Hover(target()?),
        "type" | "write" => {
            need("text")?;
            let raw = rest.trim();
            let text = if raw.len() >= 2 && ((raw.starts_with('"') && raw.ends_with('"')) || (raw.starts_with('\'') && raw.ends_with('\''))) { raw[1..raw.len() - 1].to_string() } else { raw.to_string() };
            Step::Type(text)
        }
        "key" | "keys" | "press" | "hotkey" => {
            need("keys")?;
            let mut keys = rest.trim().to_string();
            let mut times = 1;
            if let Some((k, n)) = keys.rsplit_once(" x") {
                if let Ok(n) = n.trim().parse::<u32>() {
                    times = n.clamp(1, 50);
                    keys = k.trim().to_string();
                }
            }
            Step::Key { keys: unquote(&keys), times }
        }
        "scroll" => {
            let words: Vec<&str> = rest.split_whitespace().collect();
            let dir = words.first().map(|w| w.to_ascii_lowercase()).unwrap_or_else(|| "down".into());
            let amount = words.get(1).and_then(|w| w.parse::<i32>().ok()).unwrap_or(5).clamp(1, 50);
            let at = rest.to_ascii_lowercase().find(" at ").and_then(|i| aim(&rest[i + 4..]));
            Step::Scroll { up: dir == "up" || dir == "left", sideways: dir == "left" || dir == "right", amount, at }
        }
        "drag" => {
            let lower = rest.to_ascii_lowercase();
            let i = lower.find(" to ").ok_or_else(|| format!("\"{}\" needs: drag A to B", line.trim()))?;
            Step::Drag(aim(&rest[..i]).ok_or("drag needs a start")?, aim(&rest[i + 4..]).ok_or("drag needs an end")?)
        }
        "wait" | "sleep" | "delay" => {
            let r = rest.trim();
            if let Some(words) = r.strip_prefix("for ").or_else(|| r.strip_prefix("until ")) {
                Step::WaitFor(unquote(words))
            } else {
                let n: String = r.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
                let mut secs = n.parse::<f64>().unwrap_or(2.0);
                if r.ends_with("ms") {
                    secs /= 1000.0;
                }
                Step::Wait(secs.clamp(0.05, 30.0))
            }
        }
        "focus" | "switch" => {
            need("a window title")?;
            Step::Focus(unquote(rest.trim_start_matches("to ")))
        }
        "run" | "powershell" => {
            need("a command")?;
            Step::Run(rest)
        }
        "clipboard" => Step::Clipboard,
        "saathi" => {
            need("a Saathi tool")?;
            let (tool, args) = rest.split_once(' ').unwrap_or((rest.as_str(), "{}"));
            Step::Saathi { tool: tool.trim().to_string(), args: args.trim().to_string() }
        }
        other => return Err(format!("Unknown step \"{other}\" in \"{}\"", line.trim())),
    })
}

pub fn changes_screen(step: &Step) -> bool {
    matches!(step, Step::Open(_) | Step::Click { .. } | Step::Key { .. } | Step::Scroll { .. } | Step::Drag(..) | Step::Focus(_) | Step::Type(_))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_in_every_style_are_understood() {
        assert_eq!(parse("open msedge https://youtube.com").unwrap(), Step::Open("msedge https://youtube.com".into()));
        assert_eq!(parse("click E12").unwrap(), Step::Click { aim: Aim::Id("E12".into()), button: "left", double: false });
        assert_eq!(parse("1. click 28,65").unwrap(), Step::Click { aim: Aim::Point(28.0, 65.0), button: "left", double: false });
        assert_eq!(parse("click @500, 320").unwrap(), Step::Click { aim: Aim::Point(500.0, 320.0), button: "left", double: false });
        assert_eq!(parse("click \"Bella Ciao (Official)\"").unwrap(), Step::Click { aim: Aim::Words("Bella Ciao (Official)".into()), button: "left", double: false });
        assert_eq!(parse("click {search bar}").unwrap(), Step::Click { aim: Aim::Words("search bar".into()), button: "left", double: false });
        assert_eq!(parse("double T3").unwrap(), Step::Click { aim: Aim::Id("T3".into()), button: "left", double: true });
        assert_eq!(parse("type: bella ciao").unwrap(), Step::Type("bella ciao".into()));
        assert_eq!(parse("type \"hi there\"").unwrap(), Step::Type("hi there".into()));
        assert_eq!(parse("key ctrl+l").unwrap(), Step::Key { keys: "ctrl+l".into(), times: 1 });
        assert_eq!(parse("press tab x3").unwrap(), Step::Key { keys: "tab".into(), times: 3 });
        assert_eq!(parse("wait 100ms").unwrap(), Step::Wait(0.1));
        assert_eq!(parse("delay 2").unwrap(), Step::Wait(2.0));
        assert_eq!(parse("wait for \"Subscribe\"").unwrap(), Step::WaitFor("Subscribe".into()));
        assert_eq!(parse("scroll down 3 at E2").unwrap(), Step::Scroll { up: false, sideways: false, amount: 3, at: Some(Aim::Id("E2".into())) });
        assert_eq!(parse("drag T1 to 500,500").unwrap(), Step::Drag(Aim::Id("T1".into()), Aim::Point(500.0, 500.0)));
        assert_eq!(parse("saathi get_family_messages {}").unwrap(), Step::Saathi { tool: "get_family_messages".into(), args: "{}".into() });
        assert!(parse("dance wildly").is_err());
        assert!(parse("click").is_err());
        assert!(parse("run Get-Date").unwrap().reports());
    }
}
