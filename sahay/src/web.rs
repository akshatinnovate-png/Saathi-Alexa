fn entities(s: &str) -> String {
    s.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&#x27;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").replace("&#8377;", "₹").replace("&rsquo;", "'")
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut inside = false;
    for c in s.chars() {
        match c {
            '<' => inside = true,
            '>' => {
                inside = false;
                out.push(' ');
            }
            _ if !inside => out.push(c),
            _ => {}
        }
    }
    entities(&out).split_whitespace().collect::<Vec<_>>().join(" ")
}

fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let key = format!("{name}=\"");
    let start = tag.find(&key)? + key.len();
    Some(&tag[start..start + tag[start..].find('"')?])
}

pub struct Hit {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

pub fn duckduckgo(html: &str) -> Vec<Hit> {
    let mut hits = Vec::new();
    for block in html.split("class=\"result__a\"").skip(1) {
        let head = &block[..block.find("</a>").unwrap_or(block.len()).min(block.len())];
        let href = attr(head, "href").unwrap_or("");
        let url = match href.find("uddg=") {
            Some(i) => decode(href[i + 5..].split('&').next().unwrap_or("")),
            None => href.trim_start_matches("//").to_string(),
        };
        let title = strip_tags(head.split_once('>').map(|(_, t)| t).unwrap_or(""));
        let snippet = block.split("result__snippet").nth(1).and_then(|s| s.split_once('>')).map(|(_, rest)| strip_tags(rest.split("</a>").next().unwrap_or(""))).unwrap_or_default();
        if !title.is_empty() && url.contains('.') && !url.contains("duckduckgo.com/y.js") {
            hits.push(Hit { title, url, snippet });
        }
    }
    hits
}

pub fn bing(html: &str) -> Vec<Hit> {
    let mut hits = Vec::new();
    for block in html.split("<li class=\"b_algo\"").skip(1) {
        let Some(h2) = block.split("<h2").nth(1) else { continue };
        let anchor = h2.split("</a>").next().unwrap_or("");
        let url = attr(anchor, "href").unwrap_or("").to_string();
        let title = strip_tags(anchor.split_once('>').and_then(|(_, r)| r.split_once('>')).map(|(_, t)| t).unwrap_or(""));
        let snippet = block.split("<p").nth(1).and_then(|p| p.split_once('>')).map(|(_, r)| strip_tags(r.split("</p>").next().unwrap_or(""))).unwrap_or_default();
        if !title.is_empty() && url.starts_with("http") {
            hits.push(Hit { title, url, snippet });
        }
    }
    hits
}

pub fn summarise(hits: &[Hit], max: usize) -> String {
    hits.iter().take(max).enumerate().map(|(i, h)| format!("{}. {} | {} | {}", i + 1, h.title.chars().take(110).collect::<String>(), h.url.chars().take(120).collect::<String>(), h.snippet.chars().take(220).collect::<String>())).collect::<Vec<_>>().join("\n")
}

pub fn page_text(html: &str, max: usize) -> String {
    let mut cleaned = String::new();
    let mut rest = html;
    while let Some(i) = rest.find('<') {
        cleaned.push_str(&rest[..i]);
        let tail = &rest[i..];
        let lower: String = tail.chars().take(8).collect::<String>().to_lowercase();
        let skip_to = if lower.starts_with("<script") { tail.find("</script>").map(|j| j + 9) } else if lower.starts_with("<style") { tail.find("</style>").map(|j| j + 8) } else if lower.starts_with("<noscrip") { tail.find("</noscript>").map(|j| j + 11) } else if lower.starts_with("<svg") { tail.find("</svg>").map(|j| j + 6) } else { None };
        match skip_to {
            Some(j) => rest = &tail[j..],
            None => {
                let end = tail.find('>').map(|j| j + 1).unwrap_or(tail.len());
                cleaned.push(' ');
                rest = &tail[end..];
            }
        }
    }
    cleaned.push_str(rest);
    let text = entities(&cleaned).split_whitespace().collect::<Vec<_>>().join(" ");
    text.chars().take(max).collect()
}

pub fn split_url(url: &str) -> Option<(String, String)> {
    let rest = url.trim().strip_prefix("https://").or_else(|| url.trim().strip_prefix("http://")).unwrap_or(url.trim());
    let (host, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    (!host.is_empty() && host.contains('.')).then(|| (host.to_string(), path.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_results_and_pages_become_short_text() {
        let ddg = r#"<div><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.amazon.in%2Fdp%2FB0X&amp;rut=1">Lenovo <b>IdeaPad</b> Slim 3</a><a class="result__snippet" href="x">Intel i5, 16GB RAM, &#8377;52,990</a></div>"#;
        let hits = duckduckgo(ddg);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Lenovo IdeaPad Slim 3");
        assert_eq!(hits[0].url, "https://www.amazon.in/dp/B0X");
        assert_eq!(hits[0].snippet, "Intel i5, 16GB RAM, ₹52,990");
        let bing_html = r#"<li class="b_algo"><h2><a href="https://example.com/best" h="x">Best <strong>laptops</strong> 2026</a></h2><div><p>Our picks for students.</p></div></li>"#;
        let b = bing(bing_html);
        assert_eq!(b[0].url, "https://example.com/best");
        assert_eq!(b[0].title, "Best laptops 2026");
        assert_eq!(b[0].snippet, "Our picks for students.");
        assert!(summarise(&hits, 5).starts_with("1. Lenovo IdeaPad Slim 3 | https://www.amazon.in/dp/B0X | Intel"));
        let page = "<html><head><style>.a{}</style><script>var x=1;</script></head><body><h1>Specs</h1><p>RAM: 16&nbsp;GB</p></body></html>";
        assert_eq!(page_text(page, 100), "Specs RAM: 16 GB");
        assert_eq!(split_url("https://www.amazon.in/dp/B0X?th=1"), Some(("www.amazon.in".into(), "/dp/B0X?th=1".into())));
        assert_eq!(split_url("example.com"), Some(("example.com".into(), "/".into())));
    }
}
