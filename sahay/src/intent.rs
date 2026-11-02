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
    (&["close window", "close this window", "close the window", "close this", "close it"], "alt+f4", "Closed the window."),
    (&["go back", "back", "previous page"], "alt+left", "Went back."),
    (&["go forward", "forward"], "alt+right", "Went forward."),
    (&["refresh", "reload", "refresh the page", "reload the page"], "f5", "Refreshed."),
    (&["new tab", "open a new tab", "open new tab"], "ctrl+t", "Opened a new tab."),
    (&["pause", "resume", "pause the video", "pause it", "resume it", "pause music", "play pause", "stop the music", "stop music"], "playpause", "Done."),
    (&["next", "next song", "next video", "next track", "skip"], "nexttrack", "Skipped to the next one."),
    (&["previous song", "previous track", "previous video", "last song"], "prevtrack", "Went to the previous one."),
    (&["volume up", "louder", "increase volume", "turn it up", "turn up the volume"], "volumeup", "Louder."),
    (&["volume down", "quieter", "softer", "decrease volume", "turn it down", "turn down the volume"], "volumedown", "Quieter."),
    (&["mute", "unmute", "mute it", "unmute it"], "volumemute", "Done."),
    (&["scroll down", "page down"], "page_down", "Scrolled down."),
    (&["scroll up", "page up"], "page_up", "Scrolled up."),
    (&["full screen", "fullscreen"], "f11", "Done."),
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
    let polite = ["hey sahay", "hi sahay", "sahay", "please", "pls", "plz", "can you", "could you", "would you", "will you", "kindly", "just", "now"];
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
        for p in [" please", " pls", " for me", " now"] {
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
    let math = t.trim_start_matches("what is ").trim_start_matches("what's ").trim_start_matches("whats ").trim_start_matches("calculate ").trim_start_matches("how much is ").trim();
    if let Some(v) = calculate(math) {
        return Some(Intent::Answer(format!("{} = {v}", math.trim())));
    }
    if t == "weather" || t == "what's the weather" || t == "how's the weather" || t == "weather today" {
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
            if !topic.is_empty() && topic.split_whitespace().count() <= 6 && !["the time", "the date", "today", "my name", "this", "that", "it"].contains(&topic) {
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
        if t.starts_with(p) && !t.contains(" email") && !t.contains(" message") && !t.contains(" letter") && !t.contains(" on whatsapp") {
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
        let name = rest.trim().trim_start_matches("the ").trim_end_matches(" tab").trim_end_matches(" window").trim();
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
        assert_eq!(route("play it"), None);
        assert_eq!(encode("c++ & you"), "c%2B%2B+%26+you");
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
