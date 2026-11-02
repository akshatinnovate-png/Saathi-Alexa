use crate::actions::{to_normalized, Rect};

#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub rect: Rect,
    pub interactive: bool,
}

fn normalize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() { c.to_lowercase().next().unwrap_or(c) } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn score(query: &str, label: &str) -> f64 {
    let q = normalize(query);
    let l = normalize(label);
    if q.is_empty() || l.is_empty() {
        return 0.0;
    }
    if q == l {
        return 100.0;
    }
    if l.starts_with(&q) {
        return 85.0 + 10.0 * (q.len() as f64 / l.len() as f64);
    }
    if l.contains(&q) {
        return 65.0 + 20.0 * (q.len() as f64 / l.len() as f64);
    }
    if l.len() >= 3 && q.contains(&l) {
        return 45.0 + 20.0 * (l.len() as f64 / q.len() as f64);
    }
    let qt: Vec<&str> = q.split(' ').collect();
    let lt: Vec<&str> = l.split(' ').collect();
    let common = qt.iter().filter(|t| lt.iter().any(|w| w == *t || (t.len() >= 4 && w.starts_with(*t)))).count();
    if common == 0 {
        return 0.0;
    }
    55.0 * common as f64 / qt.len() as f64 + 10.0 * common as f64 / lt.len() as f64
}

pub fn resolve<'a>(query: &str, targets: &'a [Target]) -> Option<&'a Target> {
    let q = query.trim();
    let id = q.trim_start_matches('#');
    if let Some(t) = targets.iter().find(|t| t.id.eq_ignore_ascii_case(id)) {
        return Some(t);
    }
    let unquoted = q.trim_matches(|c| c == '"' || c == '\'' || c == '“' || c == '”');
    targets
        .iter()
        .map(|t| (t, score(unquoted, &t.label) + if t.interactive { 4.0 } else { 0.0 } + if t.id.starts_with('E') { 1.0 } else { 0.0 }))
        .filter(|(_, s)| *s >= 40.0)
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(t, _)| t)
}

pub fn matches<'a>(query: &str, targets: &'a [Target]) -> Vec<&'a Target> {
    let mut found: Vec<(&Target, f64)> = targets.iter().map(|t| (t, score(query, &t.label))).filter(|(_, s)| *s >= 40.0).collect();
    found.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    found.into_iter().take(8).map(|(t, _)| t).collect()
}

pub fn overlaps(a: Rect, b: Rect) -> bool {
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

pub fn summary(window: &str, targets: &[Target], screen: Rect) -> String {
    let mut out = format!("{} Window: {}\n", crate::agent::SCREEN, window.chars().take(100).collect::<String>());
    for t in targets {
        let (x, y) = to_normalized(screen, t.rect.center().0, t.rect.center().1);
        let label: String = t.label.chars().take(48).collect();
        if t.id.starts_with('E') {
            out.push_str(&format!("{} {} \"{label}\" {x},{y}\n", t.id, t.kind));
        } else {
            out.push_str(&format!("{} \"{label}\" {x},{y}\n", t.id));
        }
    }
    if targets.is_empty() {
        out.push_str("(Nothing readable on screen yet. Try wait.)\n");
    }
    out
}

pub fn ease(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    if t < 0.5 { 4.0 * t * t * t } else { 1.0 - (-2.0 * t + 2.0).powi(3) / 2.0 }
}

pub fn glide(from: (i32, i32), to: (i32, i32)) -> Vec<(i32, i32)> {
    let dist = (f64::from(to.0 - from.0).hypot(f64::from(to.1 - from.1))).max(1.0);
    let steps = ((dist / 18.0).round() as usize).clamp(8, 40);
    (1..=steps)
        .map(|i| {
            let k = ease(i as f64 / steps as f64);
            (from.0 + (f64::from(to.0 - from.0) * k).round() as i32, from.1 + (f64::from(to.1 - from.1) * k).round() as i32)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect { left: 0, top: 0, right: 1920, bottom: 1080 };

    fn t(id: &str, label: &str, kind: &str, interactive: bool, x: i32, y: i32) -> Target {
        Target { id: id.into(), label: label.into(), kind: kind.into(), rect: Rect { left: x, top: y, right: x + 100, bottom: y + 30 }, interactive }
    }

    fn pick<'a>(q: &str, ts: &'a [Target]) -> Option<&'a str> {
        resolve(q, ts).map(|t| t.id.as_str())
    }

    #[test]
    fn targets_are_found_by_id_text_or_point() {
        let ts = vec![
            t("E1", "Search", "Edit", true, 600, 20),
            t("E2", "Add to Bag", "Button", true, 900, 500),
            t("T1", "Add to Bag", "Text", false, 900, 500),
            t("T2", "Blue Solid Crew-Neck T-shirt", "Text", false, 300, 400),
            t("E3", "Proceed to Checkout", "Button", true, 900, 700),
        ];
        assert_eq!(pick("E3", &ts), Some("E3"));
        assert_eq!(pick("#t2", &ts), Some("T2"));
        assert_eq!(pick("add to bag", &ts), Some("E2"), "the interactive control wins a tie with plain text");
        assert_eq!(pick("\"Proceed to checkout\"", &ts), Some("E3"));
        assert_eq!(pick("blue t-shirt", &ts), Some("T2"));
        assert_eq!(pick("checkout", &ts), Some("E3"));
        assert_eq!(pick("place order", &ts), None, "nothing like it on screen means no click");
    }

    #[test]
    fn find_lists_the_best_matches_first() {
        let ts = vec![t("T1", "Bella Ciao (Official Video)", "Text", false, 0, 0), t("T2", "Bella Ciao - Remix", "Text", false, 0, 50), t("T3", "Shorts", "Text", false, 0, 90)];
        let m: Vec<&str> = matches("bella ciao", &ts).iter().map(|t| t.id.as_str()).collect();
        assert_eq!(m.len(), 2);
        assert!(m.contains(&"T1") && m.contains(&"T2"));
    }

    #[test]
    fn the_summary_lists_controls_and_text_with_positions() {
        let ts = vec![t("E1", "Search", "Edit", true, 910, 525), t("T1", "Shorts", "Text", false, 0, 0)];
        let s = summary("YouTube - Google Chrome", &ts, SCREEN);
        assert!(s.starts_with("[Screen] Window: YouTube - Google Chrome\n"));
        assert!(s.contains("E1 Edit \"Search\" 500,500"));
        assert!(s.contains("T1 \"Shorts\""));
        assert!(summary("x", &[], SCREEN).contains("Nothing readable"));
    }

    #[test]
    fn the_cursor_glides_smoothly_and_lands_exactly() {
        let path = glide((0, 0), (900, 400));
        assert!(path.len() >= 8 && path.len() <= 40);
        assert_eq!(*path.last().unwrap(), (900, 400));
        let mut last = 0.0;
        for (x, _) in &path {
            assert!(f64::from(*x) >= last);
            last = f64::from(*x);
        }
        assert_eq!(glide((5, 5), (5, 5)).last(), Some(&(5, 5)));
        assert!(overlaps(Rect { left: 0, top: 0, right: 10, bottom: 10 }, Rect { left: 5, top: 5, right: 20, bottom: 20 }));
        assert!(!overlaps(Rect { left: 0, top: 0, right: 10, bottom: 10 }, Rect { left: 10, top: 0, right: 20, bottom: 10 }));
    }
}
