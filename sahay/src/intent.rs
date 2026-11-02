#[derive(Debug, Clone, PartialEq)]
pub enum Intent {
    Play { query: String, browser: Option<&'static str> },
    Open { url: String, browser: Option<&'static str>, label: String },
    App(String),
    Keys { keys: &'static str, say: &'static str },
    Close(String),
    Time,
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

pub fn route(text: &str) -> Option<Intent> {
    let t = clean(text);
    if t.is_empty() || t.len() > 160 {
        return None;
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
    }

    #[test]
    fn the_first_real_video_is_picked_from_a_results_page() {
        let page = r#"..."adSlotRenderer":{}..."videoRenderer":{"videoId":"0yMbr6PexyA","thumbnail"..."videoRenderer":{"videoId":"zzzzzzzzzzz""#;
        assert_eq!(first_video_id(page).as_deref(), Some("0yMbr6PexyA"));
        assert_eq!(first_video_id("nothing"), None);
    }
}
