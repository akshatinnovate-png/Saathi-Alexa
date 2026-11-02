#[derive(Debug, Clone, PartialEq)]
pub enum Intent {
    Play { query: String, browser: Option<&'static str> },
    Open { url: String, browser: Option<&'static str>, label: String },
    App(String),
    Keys { keys: &'static str, say: &'static str },
    Close(String),
    Time,
    Answer(String),
    Weather(String),
    Wiki(String),
    Timer { secs: u64, note: String },
    Theme(bool),
    Lock,
    Folder(&'static str),
    Type(String),
    Battery,
    Volume(u32),
    WhatsApp { to: String, text: String },
    Email { to: String, subject: String, body: String },
    Remember(String),
    Recall,
    Forget,
    ReadScreen(String),
    Selection(String),
    Routine { hour: u8, minute: u8, task: String, daily: bool },
    Routines,
    ClearRoutines,
    News,
    Convert { amount: f64, from: String, to: String },
    FindFile(String),
    Mute(bool),
    Install(String),
    Media(&'static str),
    FullScreen(bool),
    Images(Option<String>),
    CloseTabs(String),
    Teach(String),
    CloseAll,
    Import(String),
}

pub fn parse_clock(text: &str) -> Option<(u8, u8, usize)> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let first = *words.first()?;
    match first {
        "noon" | "midday" => return Some((12, 0, 1)),
        "midnight" => return Some((0, 0, 1)),
        _ => {}
    }
    let lower = first.to_ascii_lowercase();
    let (num, mut suffix) = if let Some(n) = lower.strip_suffix("am") { (n.to_string(), Some("am")) } else if let Some(n) = lower.strip_suffix("pm") { (n.to_string(), Some("pm")) } else { (lower.clone(), None) };
    let (h, m) = match num.split_once([':', '.']) {
        Some((h, m)) => (h.parse::<u8>().ok()?, m.parse::<u8>().ok()?),
        None => (num.parse::<u8>().ok()?, 0),
    };
    let mut used = 1;
    if suffix.is_none() {
        match words.get(1).map(|w| w.trim_end_matches(',').to_ascii_lowercase()) {
            Some(w) if w == "am" || w == "a.m." => {
                suffix = Some("am");
                used = 2;
            }
            Some(w) if w == "pm" || w == "p.m." => {
                suffix = Some("pm");
                used = 2;
            }
            _ => {}
        }
    }
    if m > 59 {
        return None;
    }
    let hour = match suffix {
        Some("am") if (1..=12).contains(&h) => h % 12,
        Some("pm") if (1..=12).contains(&h) => h % 12 + 12,
        None if h <= 23 => h,
        _ => return None,
    };
    Some((hour, m, used))
}

fn currency(word: &str) -> Option<&'static str> {
    Some(match word.trim_matches(['.', ',', '?']) {
        "usd" | "dollar" | "dollars" | "$" => "USD",
        "inr" | "rupee" | "rupees" | "rs" | "₹" => "INR",
        "eur" | "euro" | "euros" | "€" => "EUR",
        "gbp" | "pound" | "pounds" | "£" => "GBP",
        "aed" | "dirham" | "dirhams" => "AED",
        "jpy" | "yen" => "JPY",
        "cad" => "CAD",
        "aud" => "AUD",
        "sgd" => "SGD",
        "cny" | "yuan" => "CNY",
        "sar" | "riyal" | "riyals" => "SAR",
        _ => return None,
    })
}

fn convert(t: &str) -> Option<Intent> {
    let t = t.trim_start_matches("convert ").trim_start_matches("how much is ").trim_start_matches("what is ").trim();
    let words: Vec<&str> = t.split_whitespace().collect();
    if words.len() != 4 || !["to", "in", "into"].contains(&words[2]) {
        return None;
    }
    let amount: f64 = words[0].replace(',', "").parse().ok()?;
    Some(Intent::Convert { amount, from: currency(words[1])?.into(), to: currency(words[3])?.into() })
}

pub fn route_all(text: &str) -> Option<Vec<Intent>> {
    if let Some(i) = route(text) {
        return Some(vec![i]);
    }
    let lower = text.to_lowercase();
    for sep in [" and then ", ", then ", " then ", " and also ", " and ", ", "] {
        if !lower.contains(sep) {
            continue;
        }
        let mut parts = Vec::new();
        let mut rest = text;
        while let Some(i) = rest.to_lowercase().find(sep) {
            parts.push(rest[..i].to_string());
            rest = &rest[i + sep.len()..];
        }
        parts.push(rest.to_string());
        if parts.len() < 2 || parts.len() > 5 {
            continue;
        }
        let routed: Option<Vec<Intent>> = parts.iter().map(|p| route(p)).collect();
        if let Some(r) = routed.filter(|r| !r.iter().any(|i| matches!(i, Intent::ReadScreen(_) | Intent::Selection(_) | Intent::Routine { .. }))) {
            return Some(r);
        }
    }
    let last = text.rsplit([',', '.', '!', ';']).map(str::trim).find(|c| !c.is_empty())?;
    if last.len() < text.trim().len() {
        if let Some(i) = route(last) {
            if matches!(i, Intent::Images(_) | Intent::Media(_) | Intent::FullScreen(_) | Intent::CloseTabs(_) | Intent::Keys { .. } | Intent::Play { .. } | Intent::Weather(_) | Intent::Time | Intent::News) {
                return Some(vec![i]);
            }
        }
    }
    None
}

struct Calc<'a> {
    s: &'a [u8],
    i: usize,
}

impl Calc<'_> {
    fn ws(&mut self) {
        while self.i < self.s.len() && self.s[self.i] == b' ' {
            self.i += 1;
        }
    }
    fn peek(&mut self) -> Option<u8> {
        self.ws();
        self.s.get(self.i).copied()
    }
    fn expr(&mut self) -> Option<f64> {
        let mut v = self.term()?;
        while let Some(c) = self.peek() {
            match c {
                b'+' => {
                    self.i += 1;
                    v += self.term()?;
                }
                b'-' => {
                    self.i += 1;
                    v -= self.term()?;
                }
                _ => break,
            }
        }
        Some(v)
    }
    fn term(&mut self) -> Option<f64> {
        let mut v = self.power()?;
        while let Some(c) = self.peek() {
            match c {
                b'*' => {
                    self.i += 1;
                    v *= self.power()?;
                }
                b'/' => {
                    self.i += 1;
                    let d = self.power()?;
                    if d == 0.0 {
                        return None;
                    }
                    v /= d;
                }
                _ => break,
            }
        }
        Some(v)
    }
    fn power(&mut self) -> Option<f64> {
        let base = self.unary()?;
        if self.peek() == Some(b'^') {
            self.i += 1;
            return Some(base.powf(self.power()?));
        }
        Some(base)
    }
    fn unary(&mut self) -> Option<f64> {
        if self.peek() == Some(b'-') {
            self.i += 1;
            return Some(-self.unary()?);
        }
        let mut v = self.atom()?;
        if self.peek() == Some(b'%') {
            self.i += 1;
            v /= 100.0;
        }
        Some(v)
    }
    fn atom(&mut self) -> Option<f64> {
        if self.peek() == Some(b'(') {
            self.i += 1;
            let v = self.expr()?;
            if self.peek() != Some(b')') {
                return None;
            }
            self.i += 1;
            return Some(v);
        }
        self.ws();
        let start = self.i;
        while self.i < self.s.len() && (self.s[self.i].is_ascii_digit() || self.s[self.i] == b'.') {
            self.i += 1;
        }
        std::str::from_utf8(&self.s[start..self.i]).ok()?.parse().ok()
    }
}

pub fn calculate(text: &str) -> Option<String> {
    let mut t = format!(" {} ", text.to_lowercase());
    for (w, r) in [(" percent of ", "%*"), ("% of ", "%*"), (" percent", "%"), (" multiplied by ", "*"), (" divided by ", "/"), (" times ", "*"), (" into ", "*"), (" plus ", "+"), (" minus ", "-"), (" over ", "/"), (" x ", "*"), ("×", "*"), ("÷", "/"), (" squared", "^2"), (" cubed", "^3"), (",", "")] {
        t = t.replace(w, r);
    }
    let t = t.trim();
    if t.is_empty() || !t.chars().any(|c| c.is_ascii_digit()) || !t.chars().all(|c| c.is_ascii_digit() || " .+-*/^%()".contains(c)) || !t.chars().any(|c| "+-*/^%".contains(c)) {
        return None;
    }
    let mut c = Calc { s: t.as_bytes(), i: 0 };
    let v = c.expr()?;
    if c.peek().is_some() || !v.is_finite() {
        return None;
    }
    let rounded = (v * 1e6).round() / 1e6;
    let mut out = format!("{rounded}");
    if rounded.abs() >= 1000.0 && rounded.fract() == 0.0 {
        let digits = format!("{}", rounded.abs() as i64);
        let mut grouped = String::new();
        for (i, ch) in digits.chars().enumerate() {
            if i > 0 && (digits.len() - i) % 3 == 0 {
                grouped.push(',');
            }
            grouped.push(ch);
        }
        out = if rounded < 0.0 { format!("-{grouped}") } else { grouped };
    }
    Some(out)
}

fn duration_secs(text: &str) -> Option<u64> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut total = 0.0;
    let mut found = false;
    for (i, w) in words.iter().enumerate() {
        let n = match *w {
            "a" | "an" | "one" => Some(1.0),
            "two" => Some(2.0),
            "three" => Some(3.0),
            "five" => Some(5.0),
            "ten" => Some(10.0),
            "half" => Some(0.5),
            other => other.parse::<f64>().ok(),
        };
        let Some(n) = n else { continue };
        let unit = words.get(i + 1).copied().unwrap_or("");
        let mult = if unit.starts_with("sec") { 1.0 } else if unit.starts_with("min") { 60.0 } else if unit.starts_with("hour") || unit.starts_with("hr") { 3600.0 } else if unit == "an" && words.get(i + 2).is_some_and(|u| u.starts_with("hour")) { 1800.0 } else { continue };
        total += n * mult;
        found = true;
    }
    (found && (1.0..=86_400.0).contains(&total)).then_some(total as u64)
}

const SITES: &[(&[&str], &str, &str)] = &[
    (&["youtube", "yt"], "https://www.youtube.com", "YouTube"),
    (&["gmail", "mail", "email"], "https://mail.google.com", "Gmail"),
    (&["google"], "https://www.google.com", "Google"),
    (&["facebook", "fb"], "https://www.facebook.com", "Facebook"),
    (&["instagram", "insta"], "https://www.instagram.com", "Instagram"),
    (&["whatsapp", "whatsapp web"], "https://web.whatsapp.com", "WhatsApp"),
    (&["amazon"], "https://www.amazon.in", "Amazon"),
    (&["flipkart"], "https://www.flipkart.com", "Flipkart"),
    (&["ajio"], "https://www.ajio.com", "AJIO"),
    (&["myntra"], "https://www.myntra.com", "Myntra"),
    (&["netflix"], "https://www.netflix.com", "Netflix"),
    (&["github"], "https://github.com", "GitHub"),
    (&["chatgpt"], "https://chatgpt.com", "ChatGPT"),
    (&["maps", "google maps"], "https://www.google.com/maps", "Google Maps"),
    (&["twitter", "x"], "https://x.com", "X"),
    (&["linkedin"], "https://www.linkedin.com", "LinkedIn"),
    (&["spotify"], "https://open.spotify.com", "Spotify"),
    (&["wikipedia", "wiki"], "https://en.wikipedia.org", "Wikipedia"),
    (&["hotstar", "jiohotstar"], "https://www.hotstar.com", "Hotstar"),
];

const ENGINES: &[(&[&str], &str, &str)] = &[
    (&["google"], "https://www.google.com/search?q=", "Google"),
    (&["youtube", "yt"], "https://www.youtube.com/results?search_query=", "YouTube"),
    (&["amazon"], "https://www.amazon.in/s?k=", "Amazon"),
    (&["flipkart"], "https://www.flipkart.com/search?q=", "Flipkart"),
    (&["ajio"], "https://www.ajio.com/search/?text=", "AJIO"),
    (&["myntra"], "https://www.myntra.com/", "Myntra"),
    (&["wikipedia", "wiki"], "https://en.wikipedia.org/w/index.php?search=", "Wikipedia"),
];

const KEYS: &[(&[&str], &str, &str)] = &[
    (&["close tab", "close this tab", "close the tab"], "ctrl+w", "Closed the tab."),
    (&["send it", "send", "send that", "send this", "send it now", "send the message", "press send", "hit send", "hit enter", "press enter", "submit", "submit it", "post it", "enter"], "enter", "Sent."),
    (&["close window", "close this window", "close the window", "close this", "close it"], "alt+f4", "Closed the window."),
    (&["go back", "back", "previous page"], "alt+left", "Went back."),
    (&["go forward", "forward"], "alt+right", "Went forward."),
    (&["refresh", "reload", "refresh the page", "reload the page"], "f5", "Refreshed."),
    (&["new tab", "open a new tab", "open new tab"], "ctrl+t", "Opened a new tab."),
    (&["volume up", "louder", "increase volume", "turn it up", "turn up the volume"], "volumeup", "Louder."),
    (&["volume down", "quieter", "softer", "decrease volume", "turn it down", "turn down the volume"], "volumedown", "Quieter."),
    (&["scroll down", "page down"], "page_down", "Scrolled down."),
    (&["scroll up", "page up"], "page_up", "Scrolled up."),
    (&["minimize", "minimise", "minimize this", "minimise this"], "win+down", "Minimised."),
    (&["show desktop", "go to desktop"], "win+d", "Here's the desktop."),
    (&["zoom in"], "ctrl+plus", "Zoomed in."),
    (&["zoom out"], "ctrl+minus", "Zoomed out."),
];

pub fn encode(q: &str) -> String {
    let mut out = String::new();
    for b in q.trim().bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn clean(text: &str) -> String {
    let mut t = text.trim().to_lowercase();
    t = t.trim_end_matches(['.', '!', '?', ',']).trim().to_string();
    let polite = ["hey sahay", "hi sahay", "sahay", "please", "pls", "plz", "can you", "could you", "would you", "will you", "kindly", "just", "now", "bruh", "bro", "yaar", "dude", "ok", "okay", "arre", "abe"];
    let mut changed = true;
    while changed {
        changed = false;
        for p in polite {
            if let Some(r) = t.strip_prefix(p) {
                if r.is_empty() || r.starts_with([' ', ',']) {
                    t = r.trim_start_matches([' ', ',']).to_string();
                    changed = true;
                }
            }
        }
        for p in [" please", " pls", " for me", " now", " bruh", " bro", " yaar", " yar", " man", " dude", " ji", " na", " re", " buddy", " lol"] {
            if let Some(r) = t.strip_suffix(p) {
                t = r.trim().to_string();
                changed = true;
            }
        }
    }
    t
}

fn take_browser(t: &str) -> (String, Option<&'static str>) {
    let names: &[(&str, &'static str)] = &[("microsoft edge", "msedge"), ("ms edge", "msedge"), ("edge", "msedge"), ("google chrome", "chrome"), ("chrome", "chrome"), ("firefox", "firefox"), ("brave", "brave"), ("opera", "opera")];
    for (name, id) in names {
        for prep in ["in", "on", "using", "with"] {
            let pat = format!(" {prep} {name}");
            if let Some(i) = t.find(&pat) {
                let end = i + pat.len();
                if t[end..].is_empty() || t[end..].starts_with(' ') {
                    let rest = format!("{}{}", &t[..i], &t[end..]);
                    return (rest.split_whitespace().collect::<Vec<_>>().join(" "), Some(id));
                }
            }
        }
    }
    (t.to_string(), None)
}

fn site(name: &str) -> Option<(&'static str, &'static str)> {
    let n = name.trim().trim_start_matches("the ").trim_end_matches(" website").trim_end_matches(" site").trim();
    SITES.iter().find(|(names, _, _)| names.contains(&n)).map(|(_, url, label)| (*url, *label))
}

fn looks_like_domain(t: &str) -> bool {
    !t.contains(' ') && t.contains('.') && t.rsplit('.').next().is_some_and(|tld| (2..=6).contains(&tld.len()) && tld.chars().all(|c| c.is_ascii_alphabetic())) && !t.ends_with(".exe")
}

fn search(query: &str, engine: &str, browser: Option<&'static str>) -> Option<Intent> {
    let (_, base, label) = ENGINES.iter().find(|(names, _, _)| names.contains(&engine.trim()))?;
    let q = query.trim().trim_matches(['"', '\'']);
    if q.is_empty() {
        return None;
    }
    let url = if *label == "Myntra" { format!("{base}{}", encode(q).replace('+', "-")) } else { format!("{base}{}", encode(q)) };
    Some(Intent::Open { url, browser, label: format!("{label} results for \"{q}\"") })
}

fn is_email(s: &str) -> bool {
    let s = s.trim();
    s.split_once('@').is_some_and(|(a, b)| !a.is_empty() && b.contains('.') && !s.contains(' '))
}

pub fn route(text: &str) -> Option<Intent> {
    let raw = text.trim();
    let t = clean(text);
    if t.is_empty() || t.len() > 200 {
        return None;
    }
    let (rt, daily, default) = if let Some(r) = t.strip_prefix("every day at ").or_else(|| t.strip_prefix("everyday at ")).or_else(|| t.strip_prefix("daily at ")).or_else(|| t.strip_prefix("each day at ")) {
        (Some(r), true, None)
    } else if let Some(r) = t.strip_prefix("every morning ") {
        (Some(r), true, Some((8u8, 0u8)))
    } else if let Some(r) = t.strip_prefix("every evening ") {
        (Some(r), true, Some((18, 0)))
    } else if let Some(r) = t.strip_prefix("every night ") {
        (Some(r), true, Some((21, 0)))
    } else if let Some(r) = t.strip_prefix("at ").or_else(|| t.strip_prefix("today at ")).or_else(|| t.strip_prefix("tonight at ")) {
        (Some(r), false, None)
    } else {
        (None, false, None)
    };
    if let Some(r) = rt {
        let (hour, minute, rest) = match default {
            Some((h, m)) => (h, m, r.trim_start_matches("at ").to_string()),
            None => match parse_clock(r) {
                Some((h, m, used)) => (h, m, r.split_whitespace().skip(used).collect::<Vec<_>>().join(" ")),
                None => (99, 0, String::new()),
            },
        };
        let task_lower = rest.trim_start_matches(',').trim().to_string();
        if hour < 24 && task_lower.split_whitespace().count() >= 2 {
            let at = raw.to_lowercase().rfind(&task_lower).unwrap_or(0);
            let task = if at > 0 { raw[at..].trim().to_string() } else { task_lower.clone() };
            return Some(Intent::Routine { hour, minute, task, daily });
        }
    }
    if ["show my routines", "list my routines", "my routines", "show routines", "list routines", "what are my routines", "show my schedule"].contains(&t.as_str()) {
        return Some(Intent::Routines);
    }
    if ["clear routines", "clear my routines", "delete my routines", "delete routines", "stop all routines", "cancel all routines", "remove all routines"].contains(&t.as_str()) {
        return Some(Intent::ClearRoutines);
    }
    if ["news", "the news", "today's news", "todays news", "headlines", "latest news", "what's the news", "whats the news", "tell me the news", "top news", "news headlines"].contains(&t.as_str()) {
        return Some(Intent::News);
    }
    if let Some(c) = convert(&t) {
        return Some(c);
    }
    for p in ["find my ", "find the file ", "find file ", "open my ", "where is my ", "search my pc for ", "search my computer for ", "find the "] {
        if let Some(rest) = t.strip_prefix(p) {
            let rest = rest.trim();
            let filey = ["file", "document", "pdf", "photo", "picture", "excel", "spreadsheet", "word", "resume", "cv", "presentation", "ppt", "invoice", "bill", "receipt", "certificate", "folder"].iter().any(|w| rest.split_whitespace().any(|x| x == *w)) || p.contains("file") || p.starts_with("search");
            if filey && !rest.is_empty() && rest.split_whitespace().count() <= 5 {
                let name: Vec<&str> = rest.split_whitespace().filter(|w| !["file", "document", "the", "my"].contains(w)).collect();
                if !name.is_empty() {
                    return Some(Intent::FindFile(name.join(" ")));
                }
            }
        }
    }
    for p in ["learn from ", "teach from ", "import ", "load dataset ", "load ", "learn this dataset ", "train on ", "train from "] {
        if let Some(rest) = raw.to_lowercase().strip_prefix(p).map(|_| raw[p.len()..].trim().trim_matches(['"', '\'']).to_string()) {
            let l = rest.to_lowercase();
            if l.ends_with(".jsonl") || l.ends_with(".json") || l.ends_with(".txt") || l.ends_with(".csv") || rest.contains(":\\") || rest.starts_with("\\\\") {
                return Some(Intent::Import(rest));
            }
        }
    }
    for p in ["teach: ", "teach ", "lesson: ", "learn that ", "learn this: ", "next time ", "from now on ", "always ", "never "] {
        if let Some(rest) = t.strip_prefix(p) {
            if rest.split_whitespace().count() >= 3 {
                let keep_prefix = matches!(p, "next time " | "from now on " | "always " | "never ");
                let at = raw.to_lowercase().find(rest).unwrap_or(0);
                let body = raw[at..].trim().trim_end_matches(['.', '!']).to_string();
                return Some(Intent::Teach(if keep_prefix { format!("{}{body}", raw[..p.len()].trim_start()) } else { body }));
            }
        }
    }
    if ["close everything", "close all", "close all windows", "close all apps", "close all programs", "close all the windows", "close all the apps", "close every window", "close everything open"].contains(&t.as_str()) {
        return Some(Intent::CloseAll);
    }
    for p in ["remember that ", "remember ", "note that ", "don't forget that "] {
        if let Some(fact) = t.strip_prefix(p) {
            let start = raw.to_lowercase().find(fact).unwrap_or(0);
            let fact_raw = raw[start..].trim().trim_end_matches(['.', '!']).to_string();
            if fact.split_whitespace().count() >= 2 && !fact.starts_with("to ") {
                return Some(Intent::Remember(fact_raw));
            }
        }
    }
    if ["what do you remember", "what do you know about me", "what have you remembered", "show your memory", "show memory"].contains(&t.as_str()) {
        return Some(Intent::Recall);
    }
    if ["forget everything", "clear your memory", "forget all", "erase your memory"].contains(&t.as_str()) {
        return Some(Intent::Forget);
    }
    if ["read this page", "read the page", "read the screen", "read this", "read it", "read it to me", "read this to me", "what's on my screen", "what is on my screen", "what's on the screen", "what is on the screen", "summarize this page", "summarise this page", "summarize the page", "summarise the page", "summarize the screen", "summarise the screen", "what am i looking at", "describe the screen"].contains(&t.as_str()) {
        return Some(Intent::ReadScreen(t.clone()));
    }
    if ["explain this", "translate this", "summarize this", "summarise this", "what does this mean", "explain the selected text", "explain the selection", "summarize the selection", "summarise the selection", "simplify this", "reply to this", "proofread this", "correct this"].contains(&t.as_str()) || t.starts_with("translate this to ") || t.starts_with("translate this into ") {
        return Some(Intent::Selection(t.clone()));
    }
    let math = t.trim_start_matches("what is ").trim_start_matches("what's ").trim_start_matches("whats ").trim_start_matches("calculate ").trim_start_matches("how much is ").trim();
    if let Some(v) = calculate(math) {
        return Some(Intent::Answer(format!("{} = {v}", math.trim())));
    }
    if ["weather", "what's the weather", "whats the weather", "how's the weather", "weather today", "tell me the weather", "today's weather", "weather report", "what is the weather"].contains(&t.as_str()) {
        return Some(Intent::Weather(String::new()));
    }
    for p in ["weather in ", "what's the weather in ", "what is the weather in ", "how's the weather in ", "weather of ", "weather at ", "temperature in "] {
        if let Some(place) = t.strip_prefix(p) {
            return Some(Intent::Weather(place.trim().to_string()));
        }
    }
    for p in ["who is ", "who was ", "who's ", "tell me about ", "what is a ", "what is an ", "what was "] {
        if let Some(topic) = t.strip_prefix(p) {
            let topic = topic.trim();
            let opinion = ["best", "good", "better", "cheap", "should", "my ", " i ", "me ", "near", "under", "price", "cost", "today", "now", "latest"].iter().any(|w| format!(" {topic} ").contains(w));
            if !topic.is_empty() && topic.split_whitespace().count() <= 5 && !topic.chars().any(|c| c.is_ascii_digit()) && !opinion && !["the time", "the date", "this", "that", "it"].contains(&topic) {
                return Some(Intent::Wiki(topic.to_string()));
            }
        }
    }
    if t.starts_with("set a timer") || t.starts_with("set timer") || t.starts_with("timer for") || t.starts_with("start a timer") {
        if let Some(secs) = duration_secs(&t) {
            return Some(Intent::Timer { secs, note: String::new() });
        }
    }
    if let Some(rest) = t.strip_prefix("remind me in ").or_else(|| t.strip_prefix("remind me after ")) {
        let (when, what) = rest.split_once(" to ").unwrap_or((rest, ""));
        if let Some(secs) = duration_secs(when) {
            return Some(Intent::Timer { secs, note: what.trim().to_string() });
        }
    }
    if ["dark mode", "turn on dark mode", "switch to dark mode", "enable dark mode", "turn off light mode"].contains(&t.as_str()) {
        return Some(Intent::Theme(true));
    }
    if ["light mode", "turn on light mode", "switch to light mode", "enable light mode", "turn off dark mode"].contains(&t.as_str()) {
        return Some(Intent::Theme(false));
    }
    if ["lock", "lock the computer", "lock the pc", "lock my pc", "lock the screen", "lock screen", "lock my computer"].contains(&t.as_str()) {
        return Some(Intent::Lock);
    }
    for p in ["install ", "download and install ", "please install "] {
        if let Some(app) = t.strip_prefix(p) {
            let app = app.trim().trim_start_matches("the ").trim_end_matches(" app").trim();
            if !app.is_empty() && app.split_whitespace().count() <= 3 && !app.contains(" on ") {
                return Some(Intent::Install(app.to_string()));
            }
        }
    }
    if ["mute", "mute it", "mute the sound", "mute sound", "silence", "be quiet"].contains(&t.as_str()) {
        return Some(Intent::Mute(true));
    }
    if ["unmute", "unmute it", "unmute the sound", "sound on", "turn on the sound", "turn the sound on"].contains(&t.as_str()) {
        return Some(Intent::Mute(false));
    }
    if ["max volume", "full volume", "volume max", "volume full", "maximum volume", "full sound"].contains(&t.as_str()) {
        return Some(Intent::Volume(100));
    }
    if ["battery", "battery level", "how much battery", "how much battery is left", "what's the battery", "battery percentage"].contains(&t.as_str()) {
        return Some(Intent::Battery);
    }
    if ["take a screenshot", "screenshot", "take screenshot", "capture the screen"].contains(&t.as_str()) {
        return Some(Intent::Keys { keys: "win+printscreen", say: "Saved a screenshot in Pictures, Screenshots." });
    }
    for p in ["set volume to ", "set the volume to ", "volume to ", "volume "] {
        if let Some(n) = t.strip_prefix(p).map(|r| r.trim_end_matches('%').trim_end_matches(" percent").trim()).and_then(|r| r.parse::<u32>().ok()) {
            return Some(Intent::Volume(n.min(100)));
        }
    }
    for (names, folder) in [(&["downloads", "my downloads", "download folder", "downloads folder"][..], "Downloads"), (&["documents", "my documents", "documents folder"][..], "Documents"), (&["desktop folder"][..], "Desktop"), (&["pictures", "my pictures", "photos", "my photos"][..], "Pictures"), (&["music", "my music"][..], "Music"), (&["videos", "my videos"][..], "Videos")] {
        for verb in ["open ", "show ", "show me ", "go to "] {
            if t.strip_prefix(verb).is_some_and(|r| names.contains(&r.trim())) {
                return Some(Intent::Folder(folder));
            }
        }
    }
    let raw_lower = raw.to_lowercase();
    for p in ["type ", "write "] {
        let placed = [" in the ", " into ", " in this ", " box", " field", " bar", " email", " message", " letter", " on whatsapp", " a ", " an "].iter().any(|w| t.contains(w));
        if t.starts_with(p) && !placed {
            let at = raw_lower.find(p).map(|i| i + p.len()).unwrap_or(0);
            let body = raw[at..].trim().trim_matches(['"', '\'']).to_string();
            if !body.is_empty() {
                return Some(Intent::Type(body));
            }
        }
    }
    if t.ends_with(" on whatsapp") || t.starts_with("whatsapp ") {
        let core = t.trim_end_matches(" on whatsapp").trim_start_matches("whatsapp ");
        for verb in ["send ", "message ", "text ", "tell "] {
            if let Some(rest) = core.strip_prefix(verb) {
                let parsed = if verb == "send " {
                    rest.rsplit_once(" to ").map(|(m, who)| (who.trim(), m.trim()))
                } else {
                    rest.split_once(" saying ").or_else(|| rest.split_once(" that ")).map(|(who, m)| (who.trim(), m.trim()))
                };
                if let Some((who, msg)) = parsed {
                    let start = raw_lower.find(msg).unwrap_or(0);
                    let msg_raw = if start > 0 { raw[start..start + msg.len()].to_string() } else { msg.to_string() };
                    if !who.is_empty() && !msg.is_empty() && who.split_whitespace().count() <= 4 {
                        return Some(Intent::WhatsApp { to: who.to_string(), text: msg_raw.trim_matches(['"', '\'']).to_string() });
                    }
                }
            }
        }
    }
    for verb in ["email ", "mail ", "send an email to ", "send email to ", "write an email to ", "compose an email to "] {
        if let Some(rest) = t.strip_prefix(verb) {
            let (to, rest) = rest.split_once(' ').unwrap_or((rest, ""));
            if is_email(to) {
                let body = rest.trim().trim_start_matches("saying ").trim_start_matches("that ").trim_start_matches("about ").trim();
                let start = raw_lower.find(body).filter(|_| !body.is_empty()).unwrap_or(raw.len());
                let body_raw = raw[start..].trim().to_string();
                let subject: String = body_raw.split_whitespace().take(6).collect::<Vec<_>>().join(" ");
                return Some(Intent::Email { to: to.to_string(), subject, body: body_raw });
            }
        }
    }
    if ["what time is it", "what's the time", "whats the time", "time", "what is the time", "what's the date", "what is the date", "what day is it", "date"].contains(&t.as_str()) {
        return Some(Intent::Time);
    }
    let media: &[(&[&str], &'static str)] = &[
        (&["play", "play it", "start the video", "start it", "play the video", "start the song", "play the song", "resume", "resume it", "resume the video", "unpause", "unpause it", "continue", "continue playing", "keep playing", "start playing", "play again", "play the music", "start the music"], "play"),
        (&["pause", "pause it", "pause the video", "pause the song", "pause music", "pause the music", "stop the video", "stop the music", "stop music", "stop playing", "stop the song", "hold on", "wait pause"], "pause"),
        (&["next", "next song", "next video", "next track", "skip", "skip this", "skip this song", "skip song"], "next"),
        (&["previous", "previous song", "previous track", "previous video", "last song", "go back a song"], "previous"),
    ];
    if let Some((_, what)) = media.iter().find(|(p, _)| p.contains(&t.as_str())) {
        return Some(Intent::Media(what));
    }
    if ["full screen", "fullscreen", "full screen it", "fullscreen it", "make it full screen", "make it fullscreen", "make the video full screen", "make the video fullscreen", "full screen the video", "fullscreen the video", "video full screen", "bigger screen", "make it bigger"].contains(&t.as_str()) {
        return Some(Intent::FullScreen(true));
    }
    if ["exit full screen", "exit fullscreen", "leave full screen", "leave fullscreen", "exit full screen mode", "come out of full screen", "small screen", "make it smaller", "normal screen"].contains(&t.as_str()) {
        return Some(Intent::FullScreen(false));
    }
    for p in ["close all tabs related to ", "close all tabs about ", "close tabs related to ", "close tabs about ", "close all tabs with ", "close the tabs about ", "close all the tabs about ", "close all the tabs related to "] {
        if let Some(topic) = t.strip_prefix(p) {
            let topic = topic.split([',', '.']).next().unwrap_or("").trim().to_string();
            if !topic.is_empty() {
                return Some(Intent::CloseTabs(topic));
            }
        }
    }
    if let Some(mid) = t.strip_prefix("close all ").and_then(|r| r.strip_suffix(" tabs")) {
        if !mid.trim().is_empty() && mid != "the" {
            return Some(Intent::CloseTabs(mid.trim().trim_start_matches("the ").to_string()));
        }
    }
    let image_words = ["images", "image", "pictures", "picture", "photos", "photo", "pics", "pic"];
    for p in ["show me ", "get me ", "find me ", "find ", "search for ", "search ", "give me ", "i want ", ""] {
        if let Some(rest) = t.strip_prefix(p) {
            let rest = rest.trim().trim_start_matches("some ").trim_start_matches("a few ").trim_start_matches("more ").trim();
            for w in image_words {
                if rest == w || rest == format!("{w} of it") || rest == format!("{w} of them") || rest == format!("{w} of that") || rest == format!("an {w}") || rest == format!("{w} too") {
                    return Some(Intent::Images(None));
                }
                for joiner in [" of ", " for "] {
                    if let Some(topic) = rest.strip_prefix(&format!("{w}{joiner}")) {
                        if !topic.trim().is_empty() && !p.is_empty() || rest.starts_with(w) && !topic.trim().is_empty() && p.is_empty() {
                            return Some(Intent::Images(Some(topic.trim().to_string())));
                        }
                    }
                }
                if let Some(topic) = rest.strip_suffix(&format!(" {w}")) {
                    if !p.is_empty() && !topic.trim().is_empty() && topic.split_whitespace().count() <= 5 {
                        return Some(Intent::Images(Some(topic.trim().to_string())));
                    }
                }
            }
        }
    }
    if let Some((_, keys, say)) = KEYS.iter().find(|(phrases, _, _)| phrases.contains(&t.as_str())) {
        return Some(Intent::Keys { keys, say });
    }
    let (t, browser) = take_browser(&t);
    let play_clause = ["and play ", "then play ", "& play "].iter().find_map(|m| t.find(m).map(|i| (i, m.len())));
    if let Some((i, len)) = play_clause {
        let before = t[..i].trim();
        let opener = before.trim_start_matches("open ").trim_start_matches("go to ").trim_start_matches("launch ").trim();
        if site(opener).is_some_and(|(_, l)| l == "YouTube") {
            let query = t[i + len..].trim().trim_end_matches(" on youtube").trim_end_matches(" on yt").trim();
            if !query.is_empty() {
                return Some(Intent::Play { query: query.to_string(), browser });
            }
        }
        return None;
    }
    if t.contains(" and ") || t.contains(" then ") {
        return None;
    }
    for verb in ["play ", "put on ", "start playing ", "listen to "] {
        if let Some(rest) = t.strip_prefix(verb) {
            let mut q = rest.trim();
            let mut explicit = false;
            for s in [" on youtube", " on yt", " from youtube", " in youtube"] {
                if let Some(r) = q.strip_suffix(s) {
                    q = r.trim();
                    explicit = true;
                }
            }
            if q.contains(" on ") && !explicit {
                return None;
            }
            if !q.is_empty() && !["it", "that", "this", "music", "something", "a song", "song"].contains(&q) {
                return Some(Intent::Play { query: q.to_string(), browser });
            }
            return None;
        }
    }
    for verb in ["search for ", "search ", "look up ", "find "] {
        if let Some(rest) = t.strip_prefix(verb) {
            for (names, _, _) in ENGINES {
                for n in *names {
                    for prep in [" on ", " in "] {
                        if let Some(q) = rest.strip_suffix(&format!("{prep}{n}")) {
                            return search(q, n, browser);
                        }
                    }
                }
            }
            if verb == "find " {
                return None;
            }
            return search(rest, "google", browser);
        }
    }
    if let Some(q) = t.strip_prefix("google ") {
        return search(q, "google", browser);
    }
    if let Some(q) = t.strip_prefix("youtube ") {
        return search(q, "youtube", browser);
    }
    for verb in ["open ", "launch ", "go to ", "start ", "show me ", "take me to "] {
        if let Some(rest) = t.strip_prefix(verb) {
            let rest = rest.trim();
            if let Some((url, label)) = site(rest) {
                return Some(Intent::Open { url: url.to_string(), browser, label: label.to_string() });
            }
            if looks_like_domain(rest) {
                let url = if rest.contains("://") { rest.to_string() } else { format!("https://{rest}") };
                return Some(Intent::Open { url, browser, label: rest.to_string() });
            }
            if browser.is_none() && !rest.is_empty() && rest.split_whitespace().count() <= 3 && !rest.contains(['/', '\\']) {
                return Some(Intent::App(rest.to_string()));
            }
            return None;
        }
    }
    if let Some(rest) = t.strip_prefix("close ") {
        let name = rest.trim().trim_start_matches("the ").trim_end_matches(" only").trim_end_matches(" tab").trim_end_matches(" window").trim_end_matches(" tabs").trim();
        if ["evrything", "everythin", "everyting", "everthing", "evrythng", "everything", "all", "every thing", "all of it"].contains(&name) {
            return Some(Intent::CloseAll);
        }
        if !name.is_empty() && name.split_whitespace().count() <= 3 {
            return Some(Intent::Close(name.to_string()));
        }
    }
    None
}

pub fn is_question(text: &str) -> bool {
    let t = clean(text);
    let starts = ["what ", "who ", "why ", "how ", "when ", "where ", "which ", "is ", "are ", "can ", "could ", "should ", "do ", "does ", "explain ", "tell me ", "define ", "meaning of "];
    let acts = ["open", "click", "play", "send", "search", "close", "type", "buy", "order", "book", "install", "download", "delete", "go to", "screen", "window", "tab", "this page", "on my pc", "on the computer", "here"];
    (t.ends_with('?') || text.trim().ends_with('?') || starts.iter().any(|s| t.starts_with(s))) && !acts.iter().any(|a| t.contains(a))
}

pub fn first_video_id(page: &str) -> Option<String> {
    for marker in ["\"videoRenderer\":{\"videoId\":\"", "\"videoId\":\""] {
        let mut rest = page;
        while let Some(i) = rest.find(marker) {
            let after = &rest[i + marker.len()..];
            let id: String = after.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
            if id.len() == 11 {
                return Some(id);
            }
            rest = after;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn everyday_requests_are_understood_without_groq() {
        assert_eq!(route("Open youtube in microsoft edge and play bella ciao"), Some(Intent::Play { query: "bella ciao".into(), browser: Some("msedge") }));
        assert_eq!(route("play bella ciao"), Some(Intent::Play { query: "bella ciao".into(), browser: None }));
        assert_eq!(route("Please play Kesariya on YouTube."), Some(Intent::Play { query: "kesariya".into(), browser: None }));
        assert_eq!(route("open bella ciao on yt and play"), None);
        assert_eq!(route("open youtube"), Some(Intent::Open { url: "https://www.youtube.com".into(), browser: None, label: "YouTube".into() }));
        assert_eq!(route("open gmail in chrome"), Some(Intent::Open { url: "https://mail.google.com".into(), browser: Some("chrome"), label: "Gmail".into() }));
        assert_eq!(route("go to irctc.co.in"), Some(Intent::Open { url: "https://irctc.co.in".into(), browser: None, label: "irctc.co.in".into() }));
        assert_eq!(route("open notepad"), Some(Intent::App("notepad".into())));
        assert_eq!(route("search blue shirts on amazon"), Some(Intent::Open { url: "https://www.amazon.in/s?k=blue+shirts".into(), browser: None, label: "Amazon results for \"blue shirts\"".into() }));
        assert_eq!(route("google weather in pune"), Some(Intent::Open { url: "https://www.google.com/search?q=weather+in+pune".into(), browser: None, label: "Google results for \"weather in pune\"".into() }));
        assert_eq!(route("close tab"), Some(Intent::Keys { keys: "ctrl+w", say: "Closed the tab." }));
        assert_eq!(route("Volume up"), Some(Intent::Keys { keys: "volumeup", say: "Louder." }));
        assert_eq!(route("close github"), Some(Intent::Close("github".into())));
        assert_eq!(route("what time is it?"), Some(Intent::Time));
        assert_eq!(route("open notepad and write a letter to my son"), None);
        assert_eq!(route("buy the blue shirt in size M"), None);
        assert_eq!(encode("c++ & you"), "c%2B%2B+%26+you");
        assert_eq!(route("type my name in the search box"), None);
        assert_eq!(route("write a letter to my son"), None);
        assert_eq!(route("what is a good laptop under 50000"), None);
        assert_eq!(route("who is the best doctor near me"), None);
        assert_eq!(route("Remember that my son Ravi lives in Pune."), Some(Intent::Remember("my son Ravi lives in Pune".into())));
        assert_eq!(route("remember to call mom"), None);
        assert_eq!(route("what do you remember"), Some(Intent::Recall));
        assert_eq!(route("read this page"), Some(Intent::ReadScreen("read this page".into())));
        assert_eq!(route("translate this to hindi"), Some(Intent::Selection("translate this to hindi".into())));
        assert_eq!(route("every day at 9 am play bhajans"), Some(Intent::Routine { hour: 9, minute: 0, task: "play bhajans".into(), daily: true }));
        assert_eq!(route("At 6:30 pm remind me to walk"), Some(Intent::Routine { hour: 18, minute: 30, task: "remind me to walk".into(), daily: false }));
        assert_eq!(route("every morning tell me the weather"), Some(Intent::Routine { hour: 8, minute: 0, task: "tell me the weather".into(), daily: true }));
        assert_eq!(route("show my routines"), Some(Intent::Routines));
        assert_eq!(route("today's news"), Some(Intent::News));
        assert_eq!(route("unmute"), Some(Intent::Mute(false)));
        assert_eq!(route("install vlc"), Some(Intent::Install("vlc".into())));
        assert_eq!(route("start the video"), Some(Intent::Media("play")));
        assert_eq!(route("full screen it please"), Some(Intent::FullScreen(true)));
        assert_eq!(route("exit full screen"), Some(Intent::FullScreen(false)));
        assert_eq!(route("wow they are so cute, get me some image"), None);
        assert_eq!(route_all("wow they are so cute, get me some image"), Some(vec![Intent::Images(None)]));
        assert_eq!(route("get me some images"), Some(Intent::Images(None)));
        assert_eq!(route("show me pictures of sphynx cats"), Some(Intent::Images(Some("sphynx cats".into()))));
        assert_eq!(route("get me sphynx cat images"), Some(Intent::Images(Some("sphynx cat".into()))));
        assert_eq!(route("images of the taj mahal"), Some(Intent::Images(Some("the taj mahal".into()))));
        assert_eq!(route("close all tabs related to cats, its done"), Some(Intent::CloseTabs("cats".into())));
        assert_eq!(route("close all cat tabs"), Some(Intent::CloseTabs("cat".into())));
        assert_eq!(route("teach: on Amazon sort by customer reviews before choosing"), Some(Intent::Teach("on Amazon sort by customer reviews before choosing".into())));
        assert_eq!(route("Next time use the Amazon search box"), Some(Intent::Teach("Next time use the Amazon search box".into())));
        assert_eq!(route("Close evrything"), Some(Intent::CloseAll));
        assert_eq!(route("close everything"), Some(Intent::CloseAll));
        assert_eq!(route("send it bruh"), Some(Intent::Keys { keys: "enter", say: "Sent." }));
        assert_eq!(route("close amazon ONLY"), Some(Intent::Close("amazon".into())));
        assert_eq!(route("learn from \"C:\\Users\\me\\Downloads\\sahay-starter.jsonl\""), Some(Intent::Import("C:\\Users\\me\\Downloads\\sahay-starter.jsonl".into())));
        assert_eq!(route("Pause it"), Some(Intent::Media("pause")));
        assert_eq!(route("play it"), Some(Intent::Media("play")));
        assert_eq!(route("full volume"), Some(Intent::Volume(100)));
        assert_eq!(route("convert 100 dollars to rupees"), Some(Intent::Convert { amount: 100.0, from: "USD".into(), to: "INR".into() }));
        assert_eq!(route("50 euro in inr"), Some(Intent::Convert { amount: 50.0, from: "EUR".into(), to: "INR".into() }));
        assert_eq!(route("find my resume"), Some(Intent::FindFile("resume".into())));
        assert_eq!(route("open my tax pdf"), Some(Intent::FindFile("tax pdf".into())));
        assert_eq!(route("find my phone"), None);
        assert_eq!(route_all("open notepad and type hello there"), Some(vec![Intent::App("notepad".into()), Intent::Type("hello there".into())]));
        assert_eq!(route_all("volume to 30 and play kishore kumar songs").map(|v| v.len()), Some(2));
        assert_eq!(route_all("buy salt and pepper"), None);
        assert_eq!(parse_clock("9:30 pm"), Some((21, 30, 2)));
        assert_eq!(parse_clock("7am"), Some((7, 0, 1)));
        assert_eq!(parse_clock("21.15"), Some((21, 15, 1)));
        assert_eq!(parse_clock("noon"), Some((12, 0, 1)));
        assert_eq!(parse_clock("25"), None);
        assert!(is_question("why is the sky blue?"));
        assert!(!is_question("can you open notepad"));
        assert!(!is_question("what's on this page?"));
        assert_eq!(route("what is 23 x 45"), Some(Intent::Answer("23 x 45 = 1,035".into())));
        assert_eq!(route("15% of 2000"), Some(Intent::Answer("15% of 2000 = 300".into())));
        assert_eq!(route("weather in pune"), Some(Intent::Weather("pune".into())));
        assert_eq!(route("Who is APJ Abdul Kalam?"), Some(Intent::Wiki("apj abdul kalam".into())));
        assert_eq!(route("set a timer for 5 minutes"), Some(Intent::Timer { secs: 300, note: String::new() }));
        assert_eq!(route("remind me in 10 minutes to take my tablets"), Some(Intent::Timer { secs: 600, note: "take my tablets".into() }));
        assert_eq!(route("turn on dark mode"), Some(Intent::Theme(true)));
        assert_eq!(route("lock the pc"), Some(Intent::Lock));
        assert_eq!(route("set volume to 30%"), Some(Intent::Volume(30)));
        assert_eq!(route("open downloads"), Some(Intent::Folder("Downloads")));
        assert_eq!(route("type Hello Ravi, see you at 5"), Some(Intent::Type("Hello Ravi, see you at 5".into())));
        assert_eq!(route("send Good morning beta to Ravi on WhatsApp"), Some(Intent::WhatsApp { to: "ravi".into(), text: "Good morning beta".into() }));
        assert_eq!(route("email asha@example.com saying I reached safely"), Some(Intent::Email { to: "asha@example.com".into(), subject: "I reached safely".into(), body: "I reached safely".into() }));
    }

    #[test]
    fn the_first_real_video_is_picked_from_a_results_page() {
        let page = r#"..."adSlotRenderer":{}..."videoRenderer":{"videoId":"0yMbr6PexyA","thumbnail"..."videoRenderer":{"videoId":"zzzzzzzzzzz""#;
        assert_eq!(first_video_id(page).as_deref(), Some("0yMbr6PexyA"));
        assert_eq!(first_video_id("nothing"), None);
    }

    #[test]
    fn sums_are_worked_out_and_words_are_not() {
        assert_eq!(calculate("(2 + 3) * 4").as_deref(), Some("20"));
        assert_eq!(calculate("10 divided by 4").as_deref(), Some("2.5"));
        assert_eq!(calculate("2 ^ 10").as_deref(), Some("1,024"));
        assert_eq!(calculate("5 into 3").as_deref(), Some("15"));
        assert_eq!(calculate("1 / 0"), None);
        assert_eq!(calculate("2024"), None);
        assert_eq!(calculate("hello + you"), None);
    }
}
