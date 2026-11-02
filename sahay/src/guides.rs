const GUIDES: &[(&[&str], &str)] = &[
    (&["amazon"], "Amazon: use the page's \"Search Amazon\" box (not the browser address bar) or open https://www.amazon.in/s?k=<words>. Price filter: open https://www.amazon.in/s?k=<words>&rh=p_36%3A<min*100>-<max*100> (paise, e.g. 30000-40000 rupees = 3000000-4000000), or use the Min/Max boxes on the left and press Go. Results show title, rating and price; skip \"Sponsored\". Clicking a product often opens a NEW TAB: after clicking, the product page is in front. On the product page press \"Add to Cart\"; success shows \"Added to Cart\" or the cart number goes up by one. Never press Buy Now or Proceed to Buy without asking."),
    (&["flipkart"], "Flipkart: search with https://www.flipkart.com/search?q=<words>; close the login pop-up with its ✕ or key escape. Products open in a new tab. Press \"ADD TO CART\" (not BUY NOW); success shows \"GO TO CART\"."),
    (&["ajio", "myntra", "meesho", "shop", "buy", "cart", "order", "product", "price"], "Shopping: compare 3-5 real results (rating, number of reviews, price, key specs) with research/fetch or by reading the results page; tell the user the best pick and why. Add to cart only the chosen one, then confirm with words that are new (\"Added to Cart\"), never with a count that was already there. Never pay, never press Buy Now."),
    (&["phone", "mobile", "laptop", "tv", "fridge", "washing", "earbuds", "headphone", "watch"], "Choosing a gadget: judge by processor, RAM/storage, camera, battery, display, rating (4.2+) with many reviews, and brand service. Prefer the newest model in the budget. State the price you saw."),
    (&["youtube", "video", "song", "music", "yt"], "YouTube: open https://www.youtube.com/results?search_query=<words> to search. Click the video title text, not the channel. Play/pause only with media play/pause; full screen with key f after the video is in front. Use sound on and skip ads after opening a video."),
    (&["whatsapp"], "WhatsApp Web: open https://web.whatsapp.com (needs a one-time QR login). Click \"Search\", type the name, click the contact, click \"Type a message\", type, key enter. Confirm the message appears in the chat."),
    (&["gmail", "email", "mail"], "Gmail: compose with https://mail.google.com/mail/?view=cm&fs=1&to=<addr>&su=<subject>&body=<text>, then click \"Send\"; success shows \"Message sent\". Ask before sending to someone not named."),
    (&["google", "search", "look up", "images", "pictures"], "Google: search with https://www.google.com/search?q=<words>; images with &tbm=isch. Click result titles, skip \"Sponsored\"."),
    (&["wikipedia", "wiki"], "Wikipedia: open https://en.wikipedia.org/wiki/Special:Search?search=<words>&go=Go to land on the article directly."),
    (&["close", "quit", "exit"], "Closing: a tab is key ctrl+w, an app is focus <its title> then key alt+f4. Never close Program Manager, the taskbar, Windows Input Experience, Click to Do, Search, Start or Sahay."),
    (&["setting", "wifi", "bluetooth", "dark", "brightness", "display", "sound", "update", "printer"], "Windows settings: open ms-settings:<page> directly (network-wifi, bluetooth, colors, display, sound, windowsupdate, printers, apps-volume). Toggles are switches named after the setting; click the switch, then expect its new state (On/Off)."),
    (&["file", "folder", "document", "pdf", "explorer", "download"], "Files: use run with PowerShell (Get-ChildItem, Copy-Item, Move-Item, New-Item) instead of clicking in File Explorer; open a file with open <full path>. Never delete without asking."),
    (&["form", "sign up", "login", "log in", "register", "fill"], "Forms: click each box by its label, type, then key tab to move on. Never type passwords, OTPs or card numbers unless the user gave them for this task."),
];

pub fn relevant(task: &str, limit: usize) -> String {
    let t = task.to_lowercase();
    GUIDES.iter().filter(|(keys, _)| keys.iter().any(|k| t.contains(k))).take(limit).map(|(_, g)| *g).collect::<Vec<_>>().join("\n")
}

fn words(s: &str) -> Vec<String> {
    s.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| w.len() > 3).map(String::from).collect()
}

pub fn lessons_for(task: &str, lessons: &[String], limit: usize) -> Vec<String> {
    let tw = words(task);
    let mut scored: Vec<(usize, &String)> = lessons.iter().map(|l| (words(l).iter().filter(|w| tw.contains(w)).count(), l)).filter(|(n, _)| *n > 0).collect();
    scored.sort_by_key(|s| std::cmp::Reverse(s.0));
    scored.into_iter().take(limit).map(|(_, l)| l.clone()).collect()
}

pub fn notes(task: &str, lessons: &[String]) -> String {
    let mut out = String::new();
    let g = relevant(task, 3);
    if !g.is_empty() {
        out.push_str(&format!("\n(How-to notes:\n{g})"));
    }
    let l = lessons_for(task, lessons, 4);
    if !l.is_empty() {
        out.push_str(&format!("\n(Lessons from earlier tasks:\n- {})", l.join("\n- ")));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_relevant_know_how_is_sent() {
        let n = relevant("find me a phone on amazon between 30k and 40k", 3);
        assert!(n.contains("Search Amazon") && n.contains("Choosing a gadget"));
        assert!(!n.contains("WhatsApp"));
        assert!(relevant("hello there", 3).is_empty());
        let lessons = vec!["Amazon product links open in a new tab".to_string(), "WhatsApp needs a QR login first".to_string()];
        assert_eq!(lessons_for("add a phone to my amazon cart", &lessons, 3), vec![lessons[0].clone()]);
        assert!(notes("play a song on youtube", &[]).contains("YouTube:"));
    }
}
