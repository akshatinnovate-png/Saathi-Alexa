use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct Example {
    pub task: String,
    pub steps: Vec<String>,
    pub say: String,
}

#[derive(Debug, Default)]
pub struct Imported {
    pub examples: Vec<Example>,
    pub lessons: Vec<String>,
    pub skipped: usize,
}

fn example_from(v: &Value) -> Option<Example> {
    let task = v.get("task").or_else(|| v.get("prompt")).or_else(|| v.get("input")).and_then(Value::as_str)?.trim().to_string();
    let steps: Vec<String> = match v.get("steps").or_else(|| v.get("plan")).or_else(|| v.get("output"))? {
        Value::Array(a) => a.iter().filter_map(Value::as_str).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        Value::String(s) => s.split(['\n', '|']).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        _ => return None,
    };
    if task.is_empty() || steps.is_empty() || steps.len() > 40 || steps.iter().any(|s| crate::plan::parse(&fill_dummy(s)).is_err()) {
        return None;
    }
    let say = v.get("say").or_else(|| v.get("reply")).and_then(Value::as_str).unwrap_or("").trim().to_string();
    Some(Example { task, steps, say })
}

fn fill_dummy(step: &str) -> String {
    let mut out = String::new();
    let mut rest = step;
    while let Some(i) = rest.find('{') {
        out.push_str(&rest[..i]);
        match rest[i..].find('}') {
            Some(j) if j > 1 && j < 40 && !rest[i + 1..i + j].contains(['"', ' ']) => {
                out.push('x');
                rest = &rest[i + j + 1..];
            }
            _ => {
                out.push('{');
                rest = &rest[i + 1..];
            }
        }
    }
    out.push_str(rest);
    out
}

pub fn parse_dataset(text: &str) -> Imported {
    let mut out = Imported::default();
    let take = |v: &Value, out: &mut Imported| {
        if let Some(l) = v.get("lesson").and_then(Value::as_str) {
            out.lessons.push(l.trim().to_string());
        } else if let Some(e) = example_from(v) {
            out.examples.push(e);
        } else {
            out.skipped += 1;
        }
    };
    let trimmed = text.trim_start();
    if trimmed.starts_with('[') {
        if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(trimmed) {
            for v in &items {
                take(v, &mut out);
            }
            return out;
        }
    }
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with("//") && !l.starts_with('#')) {
        match serde_json::from_str::<Value>(line) {
            Ok(v) if v.is_object() => take(&v, &mut out),
            _ if !line.starts_with('{') && line.split_whitespace().count() >= 4 => out.lessons.push(line.to_string()),
            _ => out.skipped += 1,
        }
    }
    out
}

pub fn to_line(e: &Example) -> String {
    json!({ "task": e.task, "steps": e.steps, "say": e.say }).to_string()
}

fn tokens(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_slot = false;
    for c in s.chars() {
        match c {
            '{' => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
                in_slot = true;
                cur.push('{');
            }
            '}' if in_slot => {
                cur.push('}');
                out.push(std::mem::take(&mut cur));
                in_slot = false;
            }
            _ if in_slot => cur.push(c),
            c if c.is_alphanumeric() || c == '@' || c == '.' || c == '\'' => cur.push(c),
            _ => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out.into_iter().map(|t| if t.starts_with('{') { t } else { t.trim_end_matches('.').to_string() }).filter(|t| !t.is_empty()).collect()
}

const FILLER: &[&str] = &["please", "pls", "can", "you", "could", "would", "kindly", "sahay", "hey", "just", "for", "me", "now"];

fn matches_from(pattern: &[String], words: &[(String, String)], slots: &mut Vec<(String, String)>) -> bool {
    match pattern.first() {
        None => words.is_empty(),
        Some(p) if p.starts_with('{') => {
            let name = p.trim_matches(['{', '}']).to_string();
            for take in 1..=words.len() {
                let value = words[..take].iter().map(|(raw, _)| raw.as_str()).collect::<Vec<_>>().join(" ");
                slots.push((name.clone(), value));
                if matches_from(&pattern[1..], &words[take..], slots) {
                    return true;
                }
                slots.pop();
            }
            false
        }
        Some(p) => match words.first() {
            Some((_, lower)) if lower == p || (lower.len() > 3 && lower.trim_end_matches('s') == p.trim_end_matches('s')) => matches_from(&pattern[1..], &words[1..], slots),
            _ => false,
        },
    }
}

pub fn match_template(template: &str, request: &str) -> Option<Vec<(String, String)>> {
    let pattern: Vec<String> = tokens(&template.to_lowercase()).into_iter().filter(|t| !FILLER.contains(&t.as_str())).collect();
    if !pattern.iter().any(|t| t.starts_with('{')) || pattern.iter().filter(|t| !t.starts_with('{')).count() < 2 {
        return None;
    }
    let words: Vec<(String, String)> = tokens(request).into_iter().map(|w| (w.clone(), w.to_lowercase())).filter(|(_, l)| !FILLER.contains(&l.as_str())).collect();
    let mut slots = Vec::new();
    if !matches_from(&pattern, &words, &mut slots) {
        return None;
    }
    let vague = ["it", "this", "that", "them", "these", "those", "me", "you", "him", "her", "something", "anything"];
    if slots.iter().any(|(_, v)| vague.contains(&v.to_lowercase().as_str())) {
        return None;
    }
    Some(slots)
}

pub fn fill(step: &str, slots: &[(String, String)]) -> String {
    let mut s = step.to_string();
    for (name, value) in slots {
        s = s.replace(&format!("{{{name}:url}}"), &crate::intent::encode(value));
        s = s.replace(&format!("{{{name}}}"), value);
    }
    s
}

pub fn template_plan(examples: &[Example], request: &str) -> Option<(Vec<String>, String)> {
    for e in examples.iter().rev().filter(|e| e.task.contains('{')) {
        if let Some(slots) = match_template(&e.task, request) {
            let steps: Vec<String> = e.steps.iter().map(|s| fill(s, &slots)).collect();
            if steps.iter().all(|s| crate::plan::parse(s).is_ok()) {
                return Some((steps, fill(&e.say, &slots)));
            }
        }
    }
    None
}

fn bag(s: &str) -> Vec<String> {
    tokens(&s.to_lowercase()).into_iter().filter(|t| !t.starts_with('{') && t.len() > 2 && !FILLER.contains(&t.as_str()) && !["the", "and", "with", "from", "this", "that", "into", "onto"].contains(&t.as_str())).map(|t| t.trim_end_matches('s').to_string()).collect()
}

pub fn similar<'a>(examples: &'a [Example], request: &str, k: usize) -> Vec<&'a Example> {
    let want = bag(request);
    if want.is_empty() {
        return Vec::new();
    }
    let mut scored: Vec<(f64, &Example)> = examples
        .iter()
        .map(|e| {
            let have = bag(&e.task);
            let common = want.iter().filter(|w| have.contains(w)).count() as f64;
            (common / ((want.len() + have.len()) as f64).sqrt().max(1.0), e)
        })
        .filter(|(s, _)| *s >= 0.45)
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.into_iter().take(k).map(|(_, e)| e).collect()
}

pub fn as_hints(examples: &[&Example]) -> String {
    if examples.is_empty() {
        return String::new();
    }
    let lines: Vec<String> = examples.iter().map(|e| format!("- \"{}\" → {}", e.task, e.steps.join(" | "))).collect();
    format!("\n(Plans that worked for similar tasks; {{x}} means a value from the request:\n{})", lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const STARTER: &str = include_str!("../training/sahay-starter.jsonl");
    const MASSIVE: &str = include_str!("../training/sahay-massive.jsonl");

    #[test]
    fn the_50k_dataset_loads_completely() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("training/sahay-50k.jsonl");
        let text = std::fs::read_to_string(path).expect("the 50k dataset is in the repo");
        let d = parse_dataset(&text);
        assert_eq!(d.skipped, 0, "every line of the 50k dataset loads");
        assert!(d.examples.len() + d.lessons.len() >= 50_000, "{} examples", d.examples.len());
        let start = std::time::Instant::now();
        let hints = similar(&d.examples, "add a purple umbrella to my myntra cart", 3);
        assert!(!hints.is_empty());
        assert!(template_plan(&d.examples, "send Happy Holi to Gopal on WhatsApp").is_some());
        assert!(start.elapsed() < std::time::Duration::from_secs(5), "{:?}", start.elapsed());
    }

    #[test]
    fn the_massive_dataset_loads_completely_and_routes_sensibly() {
        let d = parse_dataset(MASSIVE);
        assert_eq!(d.skipped, 0, "every line of the massive dataset loads");
        assert!(d.examples.len() + d.lessons.len() >= 2000, "{} examples, {} lessons", d.examples.len(), d.lessons.len());
        assert!(d.lessons.len() >= 100);
        let plan = |r: &str| template_plan(&d.examples, r).map(|(s, _)| s);
        assert!(plan("add a steel water bottle to my flipkart cart").unwrap().iter().any(|s| s.contains("flipkart.com/search?q=a+steel+water+bottle")));
        assert!(plan("find phones between 30000 and 40000 on amazon").unwrap()[0].contains("p_36%3A3000000-4000000"));
        assert!(plan("where is my spectacles").unwrap()[0].starts_with("saathi where_is"), "home items go to Saathi");
        assert!(plan("where is jaipur").unwrap()[0].contains("google.com/maps/search/jaipur"));
        assert!(plan("how to make masala chai").unwrap()[0].contains("masala+chai+recipe"));
        assert!(plan("directions from pune to mumbai").unwrap()[0].contains("origin=pune&destination=mumbai"));
        assert!(plan("is it good").is_none(), "vague words don't fill a slot");
        assert!(plan("tell me a joke").is_none());
        let start = std::time::Instant::now();
        for _ in 0..20 {
            let _ = plan("send good morning to Ravi on WhatsApp");
        }
        assert!(start.elapsed() < std::time::Duration::from_secs(2), "matching 2000 templates stays fast");
    }

    #[test]
    fn templates_fill_in_from_the_request() {
        let slots = match_template("send {message} to {name} on whatsapp", "Please send Good morning beta to Ravi on WhatsApp").unwrap();
        assert_eq!(slots, vec![("message".into(), "Good morning beta".into()), ("name".into(), "Ravi".into())]);
        assert_eq!(fill("open https://www.youtube.com/results?search_query={q:url}", &[("q".into(), "bella ciao".into())]), "open https://www.youtube.com/results?search_query=bella+ciao");
        assert!(match_template("send {message} to {name} on whatsapp", "send hi to ravi").is_none());
        assert!(match_template("{anything}", "whatever").is_none(), "a template needs real words");
    }

    #[test]
    fn datasets_load_in_every_form() {
        let text = "{\"task\":\"open my amazon cart\",\"steps\":[\"open https://www.amazon.in/gp/cart/view.html\",\"expect \\\"Shopping Cart\\\"\"]}\n{\"lesson\":\"Amazon product links open in a new tab\"}\nAlways close cookie banners before clicking anything else\n{\"task\":\"bad\",\"steps\":[\"dance wildly\"]}";
        let d = parse_dataset(text);
        assert_eq!(d.examples.len(), 1);
        assert_eq!(d.lessons.len(), 2);
        assert_eq!(d.skipped, 1);
        let arr = parse_dataset("[{\"prompt\":\"refresh the page\",\"output\":\"key f5\"}]");
        assert_eq!(arr.examples[0].steps, vec!["key f5".to_string()]);
        assert_eq!(parse_dataset(&to_line(&arr.examples[0])).examples, arr.examples);
    }

    #[test]
    fn the_starter_dataset_is_valid_and_useful() {
        let d = parse_dataset(STARTER);
        assert_eq!(d.skipped, 0, "every line of the starter dataset loads");
        assert!(d.examples.len() >= 80, "{} examples", d.examples.len());
        assert!(d.lessons.len() >= 25, "{} lessons", d.lessons.len());
        let (steps, say) = template_plan(&d.examples, "add wireless mouse to my amazon cart").expect("the Amazon template matches");
        assert!(steps[0].contains("wireless+mouse"), "{steps:?}");
        assert!(say.contains("wireless mouse"));
        assert!(template_plan(&d.examples, "send happy birthday to Asha on WhatsApp").is_some());
        let hints = similar(&d.examples, "put a laptop bag in my amazon cart", 3);
        assert!(!hints.is_empty() && hints[0].task.to_lowercase().contains("amazon"));
        assert!(as_hints(&hints).contains("Plans that worked"));
    }
}
