use super::https;
use crate::web;
use std::time::Duration;

const HEADERS: &[(&str, &str)] = &[("Accept-Language", "en-IN,en;q=0.9"), ("Accept", "text/html,application/xhtml+xml")];

pub fn search(query: &str) -> Result<String, String> {
    let q = crate::intent::encode(query);
    let mut hits = Vec::new();
    if let Ok((200, html)) = https::get("html.duckduckgo.com", &format!("/html/?q={q}&kl=in-en"), HEADERS, Duration::from_secs(20)) {
        hits = web::duckduckgo(&html);
    }
    if hits.is_empty() {
        if let Ok((200, html)) = https::get("www.bing.com", &format!("/search?q={q}&setlang=en-IN"), HEADERS, Duration::from_secs(20)) {
            hits = web::bing(&html);
        }
    }
    if hits.is_empty() {
        return Err(format!("no web results for \"{query}\""));
    }
    Ok(format!("Web results for \"{query}\":\n{}", web::summarise(&hits, 8)))
}

pub fn fetch(url: &str) -> Result<String, String> {
    let (host, path) = web::split_url(url).ok_or_else(|| format!("\"{url}\" is not a web address"))?;
    let mut target = (host, path);
    for _ in 0..3 {
        let (status, body) = https::get(&target.0, &target.1, HEADERS, Duration::from_secs(25))?;
        if (200..300).contains(&status) {
            let text = web::page_text(&body, 3500);
            if text.len() < 200 {
                return Err(format!("{url} gave almost no text (it may need a browser); open it and use read instead"));
            }
            return Ok(format!("Text of {url}:\n{text}"));
        }
        if !(300..400).contains(&status) {
            return Err(format!("{url} answered {status}; open it in the browser and use read instead"));
        }
        let next = body.lines().find(|l| l.to_ascii_lowercase().starts_with("location:")).map(|l| l[9..].trim().to_string());
        match next.and_then(|n| web::split_url(&n)) {
            Some(t) => target = t,
            None => return Err(format!("{url} redirected; open it in the browser and use read instead")),
        }
    }
    Err(format!("{url} redirected too many times"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn web_research_returns_real_results() {
        let text = super::search("best budget laptop India").expect("a search engine answers");
        assert!(text.contains("1. ") && text.contains("http"), "{text}");
    }
}
