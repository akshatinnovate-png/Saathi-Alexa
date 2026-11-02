import json
import sys

out = []
seen = set()


def ex(task, steps, say=""):
    key = task.lower()
    if key in seen:
        return
    seen.add(key)
    out.append({"task": task, "steps": steps, "say": say})


def lesson(text):
    out.append({"lesson": text})


SEARCH_SITES = [
    ("google", "https://www.google.com/search?q={q:url}", []),
    ("youtube", "https://www.youtube.com/results?search_query={q:url}", []),
    ("amazon", "https://www.amazon.in/s?k={q:url}", []),
    ("flipkart", "https://www.flipkart.com/search?q={q:url}", ["key escape"]),
    ("myntra", "https://www.myntra.com/{q:url}", []),
    ("ajio", "https://www.ajio.com/search/?text={q:url}", []),
    ("nykaa", "https://www.nykaa.com/search/result/?q={q:url}", []),
    ("meesho", "https://www.meesho.com/search?q={q:url}", []),
    ("croma", "https://www.croma.com/searchB?q={q:url}", []),
    ("reliance digital", "https://www.reliancedigital.in/search?q={q:url}", []),
    ("tata cliq", "https://www.tatacliq.com/search/?searchCategory=all&text={q:url}", []),
    ("jiomart", "https://www.jiomart.com/search/{q:url}", []),
    ("bigbasket", "https://www.bigbasket.com/ps/?q={q:url}", []),
    ("snapdeal", "https://www.snapdeal.com/search?keyword={q:url}", []),
    ("pepperfry", "https://www.pepperfry.com/site_product/search?q={q:url}", []),
    ("ikea", "https://www.ikea.com/in/en/search/?q={q:url}", []),
    ("decathlon", "https://www.decathlon.in/search?query={q:url}", []),
    ("lenskart", "https://www.lenskart.com/search?q={q:url}", []),
    ("firstcry", "https://www.firstcry.com/search?q={q:url}", []),
    ("1mg", "https://www.1mg.com/search/all?name={q:url}", []),
    ("pharmeasy", "https://pharmeasy.in/search/all?name={q:url}", []),
    ("netmeds", "https://www.netmeds.com/catalogsearch/result/{q:url}/all", []),
    ("wikipedia", "https://en.wikipedia.org/wiki/Special:Search?search={q:url}&go=Go", []),
    ("bing", "https://www.bing.com/search?q={q:url}", []),
    ("duckduckgo", "https://duckduckgo.com/?q={q:url}", []),
    ("google images", "https://www.google.com/search?tbm=isch&q={q:url}", []),
    ("google news", "https://news.google.com/search?q={q:url}&hl=en-IN&gl=IN&ceid=IN:en", []),
    ("google maps", "https://www.google.com/maps/search/{q:url}", []),
    ("google scholar", "https://scholar.google.com/scholar?q={q:url}", []),
    ("google translate", "https://translate.google.com/?sl=auto&tl=en&text={q:url}&op=translate", []),
    ("github", "https://github.com/search?q={q:url}", []),
    ("stack overflow", "https://stackoverflow.com/search?q={q:url}", []),
    ("reddit", "https://www.reddit.com/search/?q={q:url}", []),
    ("quora", "https://www.quora.com/search?q={q:url}", []),
    ("twitter", "https://x.com/search?q={q:url}", []),
    ("x", "https://x.com/search?q={q:url}", []),
    ("instagram", "https://www.instagram.com/explore/search/keyword/?q={q:url}", []),
    ("facebook", "https://www.facebook.com/search/top?q={q:url}", []),
    ("linkedin", "https://www.linkedin.com/search/results/all/?keywords={q:url}", []),
    ("pinterest", "https://in.pinterest.com/search/pins/?q={q:url}", []),
    ("spotify", "https://open.spotify.com/search/{q:url}", []),
    ("jiosaavn", "https://www.jiosaavn.com/search/{q:url}", []),
    ("gaana", "https://gaana.com/search/{q:url}", []),
    ("netflix", "https://www.netflix.com/search?q={q:url}", []),
    ("hotstar", "https://www.hotstar.com/in/explore?search_query={q:url}", []),
    ("prime video", "https://www.primevideo.com/search/ref=atv_nb_sug?phrase={q:url}", []),
    ("imdb", "https://www.imdb.com/find/?q={q:url}", []),
    ("zomato", "https://www.zomato.com/search?q={q:url}", []),
    ("swiggy", "https://www.swiggy.com/search?query={q:url}", []),
    ("makemytrip", "https://www.makemytrip.com/hotels/hotel-listing/?searchText={q:url}", []),
    ("booking", "https://www.booking.com/searchresults.html?ss={q:url}", []),
    ("airbnb", "https://www.airbnb.co.in/s/{q:url}/homes", []),
    ("tripadvisor", "https://www.tripadvisor.in/Search?q={q:url}", []),
    ("khan academy", "https://www.khanacademy.org/search?page_search_query={q:url}", []),
    ("byjus", "https://www.google.com/search?q=site%3Abyjus.com+{q:url}", []),
    ("knowledgeboat", "https://www.google.com/search?q=site%3Aknowledgeboat.com+{q:url}", []),
    ("ncert", "https://www.google.com/search?q=ncert+{q:url}+pdf", []),
    ("coursera", "https://www.coursera.org/search?query={q:url}", []),
    ("udemy", "https://www.udemy.com/courses/search/?q={q:url}", []),
    ("w3schools", "https://www.google.com/search?q=site%3Aw3schools.com+{q:url}", []),
    ("geeksforgeeks", "https://www.geeksforgeeks.org/search/?gq={q:url}", []),
    ("indeed", "https://in.indeed.com/jobs?q={q:url}", []),
    ("naukri", "https://www.naukri.com/{q:url}-jobs", []),
    ("justdial", "https://www.justdial.com/search?q={q:url}", []),
    ("practo", "https://www.practo.com/search/doctors?results_type=doctor&q={q:url}", []),
    ("olx", "https://www.olx.in/items/q-{q:url}", []),
    ("99acres", "https://www.99acres.com/search/property/buy?keyword={q:url}", []),
    ("magicbricks", "https://www.magicbricks.com/property-for-sale/residential-real-estate?keyword={q:url}", []),
    ("archive", "https://archive.org/search?query={q:url}", []),
]

PHRASES = ["search {q} on {s}", "find {q} on {s}", "look for {q} on {s}", "search for {q} on {s}", "show me {q} on {s}", "look up {q} on {s}"]
for site, url, extra in SEARCH_SITES:
    for p in PHRASES:
        ex(p.format(q="{q}", s=site), ["open " + url] + extra, f"Here are {site.title()} results for {{q}}.")

SITES = [
    ("youtube", "https://www.youtube.com"), ("gmail", "https://mail.google.com"), ("google drive", "https://drive.google.com"), ("google docs", "https://docs.google.com"),
    ("google sheets", "https://sheets.google.com"), ("google calendar", "https://calendar.google.com"), ("google photos", "https://photos.google.com"), ("google meet", "https://meet.google.com"),
    ("whatsapp web", "https://web.whatsapp.com"), ("telegram web", "https://web.telegram.org"), ("amazon", "https://www.amazon.in"), ("flipkart", "https://www.flipkart.com"),
    ("myntra", "https://www.myntra.com"), ("netflix", "https://www.netflix.com"), ("hotstar", "https://www.hotstar.com"), ("prime video", "https://www.primevideo.com"),
    ("spotify", "https://open.spotify.com"), ("instagram", "https://www.instagram.com"), ("facebook", "https://www.facebook.com"), ("linkedin", "https://www.linkedin.com"),
    ("twitter", "https://x.com"), ("reddit", "https://www.reddit.com"), ("chatgpt", "https://chatgpt.com"), ("claude", "https://claude.ai"),
    ("github", "https://github.com"), ("irctc", "https://www.irctc.co.in"), ("swiggy", "https://www.swiggy.com"), ("zomato", "https://www.zomato.com"),
    ("paytm", "https://paytm.com"), ("phonepe", "https://www.phonepe.com"), ("sbi online", "https://onlinesbi.sbi"), ("hdfc netbanking", "https://netbanking.hdfcbank.com"),
    ("icici bank", "https://www.icicibank.com"), ("income tax portal", "https://www.incometax.gov.in"), ("digilocker", "https://www.digilocker.gov.in"), ("uidai", "https://uidai.gov.in"),
    ("passport seva", "https://www.passportindia.gov.in"), ("cowin", "https://www.cowin.gov.in"), ("makemytrip", "https://www.makemytrip.com"), ("goibibo", "https://www.goibibo.com"),
    ("redbus", "https://www.redbus.in"), ("uber", "https://m.uber.com"), ("ola", "https://book.olacabs.com"), ("bookmyshow", "https://in.bookmyshow.com"),
    ("khan academy", "https://www.khanacademy.org"), ("knowledgeboat", "https://www.knowledgeboat.com"), ("byjus", "https://byjus.com"), ("wikipedia", "https://en.wikipedia.org"),
    ("weather.com", "https://weather.com"), ("cricbuzz", "https://www.cricbuzz.com"), ("espn cricinfo", "https://www.espncricinfo.com"), ("times of india", "https://timesofindia.indiatimes.com"),
    ("the hindu", "https://www.thehindu.com"), ("ndtv", "https://www.ndtv.com"), ("bbc news", "https://www.bbc.com/news"), ("zerodha kite", "https://kite.zerodha.com"),
    ("groww", "https://groww.in"), ("moneycontrol", "https://www.moneycontrol.com"), ("canva", "https://www.canva.com"), ("outlook", "https://outlook.live.com"),
    ("onedrive", "https://onedrive.live.com"), ("microsoft 365", "https://www.office.com"), ("speedtest", "https://www.speedtest.net"), ("fast.com", "https://fast.com"),
]
for name, url in SITES:
    for p in ["open {n}", "go to {n}", "take me to {n}", "launch {n}"]:
        ex(p.format(n=name), ["open " + url], f"Opened {name}.")
    for b, bid in [("edge", "msedge"), ("chrome", "chrome")]:
        ex(f"open {name} in {b}", [f"open {bid} {url}"], f"Opened {name} in {b.title()}.")

YT = ["play {q} on youtube", "put on {q} on youtube", "youtube play {q}", "play {q} video", "i want to watch {q} on youtube", "can you play {q} on youtube", "start {q} on youtube", "play the song {q}", "play {q} song", "play the video {q}"]
for p in YT:
    ex(p, ["open https://www.youtube.com/results?search_query={q:url}", "click \"{q}\"", "sound on", "skip ads"], "Playing {q}.")
SONGS = ["bella ciao", "kesariya", "tum hi ho", "channa mereya", "shape of you", "believer", "despacito", "lag ja gale", "kal ho naa ho", "chaiyya chaiyya", "jai ho", "vande mataram",
         "jana gana mana", "hanuman chalisa", "gayatri mantra", "om namah shivaya", "shree ram jai ram", "achyutam keshavam", "raghupati raghav", "ae watan", "maa tujhe salaam", "dil diyan gallan",
         "apna bana le", "pasoori", "srivalli", "naatu naatu", "kun faya kun", "tujh mein rab dikhta hai", "perfect ed sheeran", "blinding lights", "senorita", "faded", "see you again", "let her go",
         "counting stars", "calm down", "levitating", "stay justin bieber", "heat waves", "unstoppable sia", "zara zara", "pehla nasha", "yeh dosti", "mere sapno ki rani", "kabhi kabhi mere dil mein",
         "tujhe dekha toh", "chura liya hai tumne", "ek pyar ka nagma hai", "ajeeb dastan hai yeh", "piya tose naina lage"]
for song in SONGS:
    ex(f"play {song}", ["open https://www.youtube.com/results?search_query=" + song.replace(" ", "+"), f"click \"{song}\"", "sound on", "skip ads"], f"Playing {song}.")
ARTISTS = ["arijit singh", "kishore kumar", "lata mangeshkar", "mohammed rafi", "asha bhosle", "ar rahman", "shreya ghoshal", "sonu nigam", "atif aslam", "jagjit singh", "ghulam ali", "nusrat fateh ali khan",
           "diljit dosanjh", "ap dhillon", "badshah", "honey singh", "ed sheeran", "taylor swift", "coldplay", "the weeknd", "imagine dragons", "eminem", "bts", "anuradha paudwal", "hariharan", "kumar sanu",
           "udit narayan", "alka yagnik", "mukesh", "pankaj udhas"]
for a in ARTISTS:
    ex(f"play {a} songs", ["open https://www.youtube.com/results?search_query=" + a.replace(" ", "+") + "+songs+playlist", f"click \"{a}\"", "sound on", "skip ads"], f"Playing {a} songs.")
GENRES = ["bhajans", "aarti", "ghazals", "old hindi songs", "90s bollywood songs", "lofi music", "relaxing music", "meditation music", "sleep music", "yoga music", "classical music", "carnatic music",
          "hindustani classical", "devotional songs", "kirtan", "gurbani", "qawwali", "sufi songs", "punjabi songs", "tamil songs", "telugu songs", "marathi songs", "bengali songs", "gujarati garba",
          "workout music", "study music", "piano music", "flute music", "rain sounds", "white noise", "kids rhymes", "nursery rhymes", "patriotic songs", "wedding songs", "party songs", "romantic songs",
          "sad songs", "motivational songs", "morning mantras", "shiv bhajans"]
for g in GENRES:
    for p in ["play {g}", "put on some {g}", "i want to listen to {g}"]:
        ex(p.format(g=g), ["open https://www.youtube.com/results?search_query=" + g.replace(" ", "+"), f"click \"{g}\"", "sound on", "skip ads"], f"Playing {g}.")
for p in ["play {q} on spotify", "spotify play {q}", "put on {q} on spotify"]:
    ex(p, ["open https://open.spotify.com/search/{q:url}", "wait for \"Songs\"", "double \"{q}\"", "sound on"], "Playing {q} on Spotify.")
for p in ["play {q} on jiosaavn", "jiosaavn play {q}"]:
    ex(p, ["open https://www.jiosaavn.com/search/{q:url}", "click \"{q}\"", "sound on"], "Playing {q} on JioSaavn.")
for p in ["watch {q} on netflix", "play {q} on netflix", "open {q} on netflix"]:
    ex(p, ["open https://www.netflix.com/search?q={q:url}", "wait 3", "click \"{q}\""], "Opening {q} on Netflix.")
for p in ["watch {q} on hotstar", "play {q} on hotstar"]:
    ex(p, ["open https://www.hotstar.com/in/explore?search_query={q:url}", "wait 3", "click \"{q}\""], "Opening {q} on Hotstar.")
for p in ["watch {q} on prime video", "play {q} on prime video"]:
    ex(p, ["open https://www.primevideo.com/search/ref=atv_nb_sug?phrase={q:url}", "wait 3", "click \"{q}\""], "Opening {q} on Prime Video.")
for p in ["how to {q}", "show me how to {q}", "teach me how to {q}", "video on how to {q}"]:
    ex(p, ["open https://www.youtube.com/results?search_query=how+to+{q:url}", "click \"{q}\"", "sound on", "skip ads"], "Here's a video on how to {q}.")
for p in ["recipe for {q}", "how to make {q}", "how to cook {q}", "{q} recipe"]:
    ex(p, ["open https://www.youtube.com/results?search_query={q:url}+recipe", "click \"{q}\"", "sound on", "skip ads"], "Here's a {q} recipe.")
for p in ["explain {q} with a video", "explain {q} in a video", "video explaining {q}"]:
    ex(p, ["open https://www.youtube.com/results?search_query={q:url}+explained", "click \"{q}\"", "sound on", "skip ads"], "Here's a video explaining {q}.")

MEDIA = [("pause the music", "media pause"), ("resume the music", "media play"), ("start the song", "media play"), ("stop the video", "media pause"), ("next song please", "media next"),
         ("play the next video", "media next"), ("previous song please", "media previous"), ("play the last song again", "media previous"), ("turn the volume up", "volume 80"), ("make it louder", "volume 90"),
         ("make it quieter", "volume 30"), ("set the volume to half", "volume 50"), ("max the volume", "volume 100"), ("turn the sound off", "mute"), ("turn the sound back on", "unmute"),
         ("skip this ad", "skip ads"), ("make sure the sound is on", "sound on")]
for t, step in MEDIA:
    ex(t, [step], "Done.")
YTKEYS = [("go forward 10 seconds", "key l"), ("skip ahead 10 seconds", "key l"), ("go back 10 seconds", "key j"), ("rewind 10 seconds", "key j"), ("go forward 5 seconds", "key right"),
          ("go back 5 seconds", "key left"), ("make the video faster", "key shift+."), ("speed up the video", "key shift+."), ("make the video slower", "key shift+,"), ("slow down the video", "key shift+,"),
          ("turn on subtitles", "key c"), ("turn off subtitles", "key c"), ("turn on captions", "key c"), ("restart the video", "key 0"), ("go to the middle of the video", "key 5"),
          ("theatre mode", "key t"), ("mini player", "key i"), ("make the video full screen", "key f"), ("exit the video full screen", "key escape"), ("mute the video", "key m")]
for t, k in YTKEYS:
    ex(t, [k], "Done.")

STORES = [
    ("amazon", "https://www.amazon.in/s?k={item:url}", "Add to Cart", "Added to Cart", []),
    ("flipkart", "https://www.flipkart.com/search?q={item:url}", "ADD TO CART", "GO TO CART", ["key escape"]),
    ("myntra", "https://www.myntra.com/{item:url}", "ADD TO BAG", "GO TO BAG", []),
    ("ajio", "https://www.ajio.com/search/?text={item:url}", "ADD TO BAG", "GO TO BAG", []),
    ("nykaa", "https://www.nykaa.com/search/result/?q={item:url}", "Add to Bag", "View Bag", []),
    ("croma", "https://www.croma.com/searchB?q={item:url}", "Add to Cart", "View Cart", []),
    ("jiomart", "https://www.jiomart.com/search/{item:url}", "Add to Cart", "View Cart", []),
    ("bigbasket", "https://www.bigbasket.com/ps/?q={item:url}", "Add", "Basket", []),
    ("1mg", "https://www.1mg.com/search/all?name={item:url}", "ADD TO CART", "VIEW CART", []),
    ("meesho", "https://www.meesho.com/search?q={item:url}", "Add to Cart", "Go to Cart", []),
]
for store, url, button, done, extra in STORES:
    steps = ["open " + url] + extra + ["click \"{item}\"", f"wait for \"{button}\"", f"click \"{button}\"", f"expect \"{done}\""]
    for p in ["add {item} to my {s} cart", "put {item} in my {s} cart", "add {item} to cart on {s}", "buy {item} on {s}", "order {item} from {s}", "get me {item} from {s}"]:
        ex(p.format(item="{item}", s=store), steps, f"Added {{item}} to your {store.title()} cart. I haven't paid; check the cart when you're ready.")
for p in ["find {item} on amazon under {price}", "{item} under {price} on amazon", "show me {item} under rs {price} on amazon", "find {item} below {price} on amazon"]:
    ex(p, ["open https://www.amazon.in/s?k={item:url}&rh=p_36%3A-{price}00", "expect \"results\""], "Here are {item} under ₹{price} on Amazon.")
for p in ["find {item} between {min} and {max} on amazon", "{item} from {min} to {max} on amazon", "show me {item} between rs {min} and {max} on amazon", "find a {item} in the {min} to {max} range on amazon"]:
    ex(p, ["open https://www.amazon.in/s?k={item:url}&rh=p_36%3A{min}00-{max}00", "expect \"results\""], "Here are {item} from ₹{min} to ₹{max} on Amazon.")
for p in ["find {item} under {price} on flipkart", "{item} under {price} on flipkart", "find {item} below {price} on flipkart"]:
    ex(p, ["open https://www.flipkart.com/search?q={item:url}&p%5B%5D=facets.price_range.to%3D{price}", "key escape"], "Here are {item} under ₹{price} on Flipkart.")
for p in ["find {item} between {min} and {max} on flipkart", "{item} from {min} to {max} on flipkart"]:
    ex(p, ["open https://www.flipkart.com/search?q={item:url}&p%5B%5D=facets.price_range.from%3D{min}&p%5B%5D=facets.price_range.to%3D{max}", "key escape"], "Here are {item} from ₹{min} to ₹{max} on Flipkart.")
for sort, code, word in [("best rated", "review-rank", "best rated"), ("top rated", "review-rank", "top rated"), ("cheapest", "price-asc-rank", "cheapest"), ("most expensive", "price-desc-rank", "priciest"), ("newest", "date-desc-rank", "newest")]:
    for p in [f"find the {sort} {{item}} on amazon", f"show me the {sort} {{item}} on amazon", f"{sort} {{item}} on amazon"]:
        ex(p, ["open https://www.amazon.in/s?k={item:url}&s=" + code, "expect \"results\""], f"Here are the {word} {{item}} on Amazon.")
for p in ["compare {a} and {b}", "{a} vs {b}", "compare {a} with {b}", "which is better {a} or {b}"]:
    ex(p, ["research {a} vs {b} comparison"], "")
for p in ["best {item} under {price}", "suggest a good {item} under {price}", "which {item} should i buy under {price}", "recommend a {item} under {price}"]:
    ex(p, ["research best {item} under {price} india"], "")
for p in ["reviews of {item}", "is {item} good", "show me reviews for {item}"]:
    ex(p, ["research {item} review"], "")
for p in ["price of {item}", "how much does {item} cost", "what is the price of {item}"]:
    ex(p, ["research {item} price india"], "")
ACCOUNT = [("open my amazon cart", "https://www.amazon.in/gp/cart/view.html", "Shopping Cart"), ("show my amazon orders", "https://www.amazon.in/gp/your-account/order-history", "Your Orders"),
           ("open my amazon wishlist", "https://www.amazon.in/hz/wishlist/ls", "Your Lists"), ("open amazon prime video", "https://www.primevideo.com", ""), ("open amazon pay", "https://www.amazon.in/amazonpay/home", ""),
           ("open my flipkart cart", "https://www.flipkart.com/viewcart", "Cart"), ("show my flipkart orders", "https://www.flipkart.com/account/orders", "Orders"), ("open my flipkart wishlist", "https://www.flipkart.com/wishlist", ""),
           ("show my myntra orders", "https://www.myntra.com/my/orders", ""), ("open my myntra bag", "https://www.myntra.com/checkout/cart", ""), ("show my swiggy orders", "https://www.swiggy.com/my-account", ""),
           ("show my zomato orders", "https://www.zomato.com/users/orders", ""), ("open my youtube history", "https://www.youtube.com/feed/history", "Watch history"), ("open my youtube subscriptions", "https://www.youtube.com/feed/subscriptions", "Subscriptions"),
           ("open my youtube liked videos", "https://www.youtube.com/playlist?list=LL", ""), ("open youtube watch later", "https://www.youtube.com/playlist?list=WL", ""), ("open youtube trending", "https://www.youtube.com/feed/trending", ""),
           ("open youtube shorts", "https://www.youtube.com/shorts", ""), ("open my gmail inbox", "https://mail.google.com/mail/u/0/#inbox", "Compose"), ("open my unread emails", "https://mail.google.com/mail/u/0/#search/is%3Aunread", "Compose"),
           ("open my sent emails", "https://mail.google.com/mail/u/0/#sent", "Compose"), ("open my starred emails", "https://mail.google.com/mail/u/0/#starred", "Compose"), ("open gmail spam", "https://mail.google.com/mail/u/0/#spam", "Compose"),
           ("open my google drive", "https://drive.google.com/drive/my-drive", "My Drive"), ("open my google calendar", "https://calendar.google.com", ""), ("open my google photos", "https://photos.google.com", ""),
           ("open my linkedin messages", "https://www.linkedin.com/messaging/", ""), ("open my instagram messages", "https://www.instagram.com/direct/inbox/", ""), ("open my facebook messages", "https://www.facebook.com/messages", ""),
           ("open my github repositories", "https://github.com/?tab=repositories", ""), ("open irctc pnr status", "https://www.indianrail.gov.in/enquiry/PNR/PnrEnquiry.html", ""), ("open my digilocker documents", "https://www.digilocker.gov.in/home", "")]
for t, url, word in ACCOUNT:
    steps = ["open " + url] + ([f"expect \"{word}\""] if word else [])
    ex(t, steps, "Here it is.")
    ex(t.replace("open ", "show ", 1).replace("show my", "show me my", 1) if t.startswith("open") else t.replace("show ", "open ", 1), steps, "Here it is.")

WA = ["send {message} to {name} on whatsapp", "whatsapp {name} {message}", "message {name} on whatsapp saying {message}", "text {name} on whatsapp {message}", "tell {name} on whatsapp that {message}",
      "send a whatsapp to {name} saying {message}", "send {name} a whatsapp message saying {message}", "on whatsapp tell {name} {message}", "send whatsapp message {message} to {name}", "write to {name} on whatsapp {message}"]
WA_STEPS = ["open https://web.whatsapp.com", "wait for \"Search\"", "click \"Search\"", "type {name}", "wait 1.5", "click \"{name}\"", "wait for \"Type a message\"", "click \"Type a message\"", "type {message}", "key enter"]
for p in WA:
    ex(p, WA_STEPS, "Sent \"{message}\" to {name}.")
for p in ["open whatsapp chat with {name}", "open my chat with {name} on whatsapp", "show my whatsapp chat with {name}"]:
    ex(p, WA_STEPS[:6], "Here's your chat with {name}.")
for p in ["send an email to {email} saying {body}", "email {email} saying {body}", "mail {email} that {body}", "write an email to {email} saying {body}"]:
    ex(p, ["open https://mail.google.com/mail/?view=cm&fs=1&to={email:url}&body={body:url}", "wait for \"Send\"", "click \"Send\"", "expect \"Message sent\""], "Sent the email to {email}.")
for p in ["draft an email to {email} about {subject}", "write an email to {email} about {subject}", "compose a mail to {email} about {subject}"]:
    ex(p, ["open https://mail.google.com/mail/?view=cm&fs=1&to={email:url}&su={subject:url}", "wait for \"Send\""], "The email to {email} is ready; check it and press Send.")
for p in ["search my email for {q}", "find emails about {q}", "find emails from {q}", "search gmail for {q}"]:
    ex(p, ["open https://mail.google.com/mail/u/0/#search/{q:url}", "expect \"Compose\""], "Here are emails matching {q}.")
for p in ["schedule a meeting {title}", "create a calendar event {title}", "add {title} to my calendar"]:
    ex(p, ["open https://calendar.google.com/calendar/render?action=TEMPLATE&text={title:url}", "wait for \"Save\""], "The event {title} is ready; set the time and press Save.")
for p in ["start a google meet", "start a video call", "create a meet link"]:
    ex(p, ["open https://meet.google.com/new"], "A new Google Meet is starting.")

MAPS = ["directions to {place}", "how do i get to {place}", "route to {place}", "navigate to {place}", "take me to {place} on maps", "how far is {place}", "show the way to {place}"]
for p in MAPS:
    ex(p, ["open https://www.google.com/maps/dir/?api=1&destination={place:url}"], "Here are directions to {place}.")
for p in ["directions from {a} to {b}", "route from {a} to {b}", "how far is {b} from {a}", "distance from {a} to {b}"]:
    ex(p, ["open https://www.google.com/maps/dir/?api=1&origin={a:url}&destination={b:url}"], "Here's the route from {a} to {b}.")
for p in ["show {place} on the map", "where is {place}", "find {place} on google maps", "map of {place}"]:
    ex(p, ["open https://www.google.com/maps/search/{place:url}"], "Here's {place} on the map.")
NEAR = ["hospitals", "pharmacies", "medical stores", "atms", "banks", "petrol pumps", "restaurants", "cafes", "temples", "gurudwaras", "mosques", "churches", "parks", "gyms", "schools", "post offices",
        "police stations", "clinics", "dentists", "eye clinics", "supermarkets", "grocery stores", "salons", "tailors", "mobile repair shops", "hardware stores", "bakeries", "sweet shops", "bus stops", "metro stations"]
for n in NEAR:
    for p in ["find {n} near me", "{n} near me", "nearest {n}"]:
        ex(p.format(n=n), ["open https://www.google.com/maps/search/" + n.replace(" ", "+") + "+near+me"], f"Here are {n} near you.")
for p in ["find {thing} near me", "{thing} near me", "nearest {thing}", "where is the nearest {thing}"]:
    ex(p, ["open https://www.google.com/maps/search/{thing:url}+near+me"], "Here are {thing} near you.")

INFO = [
    (["meaning of {w}", "what does {w} mean", "define {w}", "definition of {w}"], "https://www.google.com/search?q=meaning+of+{w:url}", "Here's the meaning of {w}."),
    (["synonym of {w}", "another word for {w}", "synonyms for {w}"], "https://www.google.com/search?q=synonyms+of+{w:url}", "Here are synonyms of {w}."),
    (["{w} in hindi", "translate {w} to hindi", "what is {w} in hindi"], "https://translate.google.com/?sl=auto&tl=hi&text={w:url}&op=translate", "Here's {w} in Hindi."),
    (["{w} in english", "translate {w} to english", "what is {w} in english"], "https://translate.google.com/?sl=auto&tl=en&text={w:url}&op=translate", "Here's {w} in English."),
    (["translate {w} to marathi", "{w} in marathi"], "https://translate.google.com/?sl=auto&tl=mr&text={w:url}&op=translate", "Here's {w} in Marathi."),
    (["translate {w} to tamil", "{w} in tamil"], "https://translate.google.com/?sl=auto&tl=ta&text={w:url}&op=translate", "Here's {w} in Tamil."),
    (["translate {w} to bengali", "{w} in bengali"], "https://translate.google.com/?sl=auto&tl=bn&text={w:url}&op=translate", "Here's {w} in Bengali."),
    (["translate {w} to gujarati", "{w} in gujarati"], "https://translate.google.com/?sl=auto&tl=gu&text={w:url}&op=translate", "Here's {w} in Gujarati."),
    (["lyrics of {w}", "{w} lyrics", "show me the lyrics of {w}"], "https://www.google.com/search?q={w:url}+lyrics", "Here are the lyrics of {w}."),
    (["{w} share price", "share price of {w}", "{w} stock price", "how is {w} stock doing"], "https://www.google.com/search?q={w:url}+share+price", "Here's the {w} share price."),
    (["{w} score", "live score of {w}", "{w} match score"], "https://www.google.com/search?q={w:url}+live+score", "Here's the {w} score."),
    (["time in {w}", "what time is it in {w}", "current time in {w}"], "https://www.google.com/search?q=time+in+{w:url}", "Here's the time in {w}."),
    (["hotels in {w}", "find hotels in {w}", "book a hotel in {w}"], "https://www.google.com/travel/hotels/{w:url}", "Here are hotels in {w}."),
    (["things to do in {w}", "places to visit in {w}", "tourist places in {w}"], "https://www.google.com/search?q=places+to+visit+in+{w:url}", "Here are places to visit in {w}."),
    (["movies in {w}", "movie tickets in {w}", "what movies are showing in {w}"], "https://in.bookmyshow.com/explore/movies-{w:url}", "Here are movies in {w}."),
    (["news about {w}", "latest news on {w}", "what's happening with {w}"], "https://news.google.com/search?q={w:url}&hl=en-IN&gl=IN&ceid=IN:en", "Here's the news about {w}."),
    (["{w} wikipedia", "wikipedia page on {w}", "open the wikipedia page for {w}"], "https://en.wikipedia.org/wiki/Special:Search?search={w:url}&go=Go", "Here's {w} on Wikipedia."),
    (["symptoms of {w}", "what are the symptoms of {w}"], "https://www.google.com/search?q=symptoms+of+{w:url}", "Here are the symptoms of {w}; see a doctor if you're unwell."),
    (["side effects of {w}", "uses of {w} tablet", "what is {w} tablet used for"], "https://www.1mg.com/search/all?name={w:url}", "Here's {w} on 1mg; ask your doctor before changing medicines."),
    (["jobs for {w}", "{w} jobs", "find {w} jobs"], "https://in.indeed.com/jobs?q={w:url}", "Here are {w} jobs."),
    (["{w} near me doctor", "find a {w} doctor", "book a {w} doctor"], "https://www.practo.com/search/doctors?results_type=doctor&q={w:url}", "Here are {w} doctors on Practo."),
    (["ncert class {w} books", "ncert books class {w}"], "https://ncert.nic.in/textbook.php", "Here are the NCERT books."),
    (["{w} pdf", "download {w} pdf", "find {w} pdf"], "https://www.google.com/search?q={w:url}+filetype%3Apdf", "Here are PDFs of {w}."),
    (["images of {w}", "pictures of {w}", "photos of {w}", "show me pictures of {w}"], "https://www.google.com/search?tbm=isch&q={w:url}", "Here are pictures of {w}."),
    (["{w} quotes", "quotes about {w}", "quotes by {w}"], "https://www.google.com/search?q={w:url}+quotes", "Here are quotes about {w}."),
    (["{w} horoscope", "today's horoscope for {w}", "horoscope {w}"], "https://www.google.com/search?q={w:url}+horoscope+today", "Here's today's {w} horoscope."),
]
for phrases, url, say in INFO:
    for p in phrases:
        ex(p, ["open " + url], say)
for p in ["flights from {a} to {b}", "cheap flights from {a} to {b}", "book a flight from {a} to {b}"]:
    ex(p, ["open https://www.google.com/travel/flights?q=flights+from+{a:url}+to+{b:url}"], "Here are flights from {a} to {b}.")
for p in ["trains from {a} to {b}", "train from {a} to {b}", "book a train from {a} to {b}"]:
    ex(p, ["open https://www.google.com/search?q=trains+from+{a:url}+to+{b:url}"], "Here are trains from {a} to {b}.")
for p in ["buses from {a} to {b}", "bus from {a} to {b}", "book a bus from {a} to {b}"]:
    ex(p, ["open https://www.redbus.in/search?fromCityName={a:url}&toCityName={b:url}"], "Here are buses from {a} to {b}.")
for p in ["check train {n} running status", "where is train {n}", "train {n} live status", "running status of train {n}"]:
    ex(p, ["open https://www.google.com/search?q=train+{n}+running+status"], "Here's train {n}.")
for p in ["check pnr {n}", "pnr status {n}", "check my pnr {n}"]:
    ex(p, ["open https://www.google.com/search?q=pnr+status+{n}"], "Here's PNR {n}.")
for p in ["convert {x} to {y}", "{x} to {y}", "how many {y} in {x}"]:
    ex(p, ["open https://www.google.com/search?q={x:url}+to+{y:url}"], "Here's {x} in {y}.")
FIXED_INFO = [("show the live cricket score", "live+cricket+score"), ("india match score", "india+cricket+score"), ("ipl score", "ipl+live+score"), ("gold rate today", "gold+rate+today+india"),
              ("silver rate today", "silver+rate+today+india"), ("petrol price today", "petrol+price+today"), ("diesel price today", "diesel+price+today"), ("sensex today", "sensex"),
              ("nifty today", "nifty+50"), ("dollar rate today", "usd+to+inr"), ("today's panchang", "today+panchang"), ("today's tithi", "today+tithi"), ("sunrise time today", "sunrise+time+today"),
              ("sunset time today", "sunset+time+today"), ("next holiday", "next+public+holiday+india"), ("bank holidays this month", "bank+holidays+this+month+india"),
              ("air quality today", "air+quality+index+near+me"), ("covid cases today", "covid+cases+india+today"), ("election results", "election+results+live"), ("today's date in hindi calendar", "aaj+ki+tithi")]
for t, q in FIXED_INFO:
    ex(t, ["open https://www.google.com/search?q=" + q], "Here it is.")

BROWSER = [
    (["copy this page link", "copy the link", "copy this url"], ["key ctrl+l", "key ctrl+c", "key escape"], "Copied the link."),
    (["bookmark this page", "save this page as a bookmark", "add this to favourites"], ["key ctrl+d", "key enter"], "Bookmarked."),
    (["reopen the closed tab", "open the tab i just closed", "bring back the last tab"], ["key ctrl+shift+t"], "Reopened the tab."),
    (["open a private window", "open an incognito window", "open inprivate"], ["key ctrl+shift+n"], "Opened a private window."),
    (["go to the next tab", "switch to the next tab", "next tab"], ["key ctrl+tab"], "Next tab."),
    (["go to the previous tab", "switch to the previous tab", "previous tab"], ["key ctrl+shift+tab"], "Previous tab."),
    (["go to the first tab", "switch to the first tab"], ["key ctrl+1"], "First tab."),
    (["go to the last tab", "switch to the last tab"], ["key ctrl+9"], "Last tab."),
    (["go to the top of the page", "scroll to the top", "back to top"], ["key home"], "At the top."),
    (["go to the bottom of the page", "scroll to the bottom", "go to the end of the page"], ["key end"], "At the bottom."),
    (["print this page", "print this", "print it"], ["key ctrl+p"], "The print window is open."),
    (["save this page", "download this page"], ["key ctrl+s"], "The save window is open."),
    (["open my downloads in the browser", "show browser downloads"], ["key ctrl+j"], "Here are your downloads."),
    (["open browser history", "show my browsing history", "show history"], ["key ctrl+h"], "Here's your history."),
    (["clear browsing data", "clear my history", "clear the browser cache"], ["key ctrl+shift+delete"], "The clear-data window is open; choose what to clear."),
    (["close this tab", "close the tab", "close current tab"], ["key ctrl+w"], "Closed the tab."),
    (["open a new tab", "new tab please"], ["key ctrl+t"], "Opened a new tab."),
    (["open a new window", "new browser window"], ["key ctrl+n"], "Opened a new window."),
    (["reload the page", "refresh this", "refresh the page please"], ["key f5"], "Refreshed."),
    (["hard refresh", "reload without cache"], ["key ctrl+f5"], "Reloaded."),
    (["zoom in the page", "make the text bigger", "make it bigger"], ["key ctrl+plus"], "Zoomed in."),
    (["zoom out the page", "make the text smaller", "make it smaller"], ["key ctrl+minus"], "Zoomed out."),
    (["reset zoom", "normal size page", "actual size"], ["key ctrl+0"], "Zoom reset."),
    (["go back a page", "previous page please", "go back"], ["key alt+left"], "Went back."),
    (["go forward a page", "next page please"], ["key alt+right"], "Went forward."),
    (["open the address bar", "focus the address bar"], ["key ctrl+l"], "The address bar is selected."),
    (["read this page aloud", "read aloud"], ["key ctrl+shift+u"], "Reading the page aloud."),
    (["open immersive reader", "reader mode"], ["key f9"], "Reader mode."),
    (["open browser settings", "edge settings", "chrome settings"], ["open msedge edge://settings"], "Settings are open."),
    (["open extensions", "manage extensions"], ["open msedge edge://extensions"], "Extensions are open."),
    (["open saved passwords", "show saved passwords"], ["open msedge edge://settings/passwords"], "Saved passwords are open."),
    (["show all tabs", "search my tabs"], ["key ctrl+shift+a"], "Tab search is open."),
    (["pin this tab"], ["right \"tab\""], "Right-click the tab menu is open; choose Pin."),
    (["take a screenshot of this page", "web capture", "screenshot this page"], ["key ctrl+shift+s"], "Web capture is open."),
    (["open developer tools", "inspect this page"], ["key f12"], "Developer tools are open."),
    (["view page source"], ["key ctrl+u"], "Here's the page source."),
]
for phrases, steps, say in BROWSER:
    for p in phrases:
        ex(p, steps, say)
for p in ["find {word} on this page", "search this page for {word}", "highlight {word} on this page", "where does it say {word}"]:
    ex(p, ["key ctrl+f", "type {word}", "key enter"], "Searching the page for {word}.")
for p in ["open {url} in a new tab", "open a new tab with {url}"]:
    ex(p, ["key ctrl+t", "type {url}", "key enter"], "Opened {url}.")
for p in ["switch to the {title} tab", "go to the {title} tab", "show the {title} tab"]:
    ex(p, ["click \"{title} tab\""], "Here's the {title} tab.")
for p in ["close the {title} tab", "close {title} tab"]:
    ex(p, ["click \"{title} tab\"", "key ctrl+w"], "Closed the {title} tab.")

EDIT = [
    (["select all", "select everything"], ["key ctrl+a"], "Selected everything."),
    (["copy that", "copy this", "copy it"], ["key ctrl+c"], "Copied."),
    (["paste it", "paste here", "paste that"], ["key ctrl+v"], "Pasted."),
    (["cut that", "cut this"], ["key ctrl+x"], "Cut."),
    (["undo that", "undo", "take that back"], ["key ctrl+z"], "Undone."),
    (["redo that", "redo"], ["key ctrl+y"], "Redone."),
    (["save the file", "save this file", "save it"], ["key ctrl+s"], "Saved."),
    (["save as", "save a copy"], ["key f12"], "The Save As window is open."),
    (["make it bold", "bold this"], ["key ctrl+b"], "Bold."),
    (["make it italic", "italic this"], ["key ctrl+i"], "Italic."),
    (["underline this", "underline it"], ["key ctrl+u"], "Underlined."),
    (["new line", "press enter"], ["key enter"], "Done."),
    (["delete the last word"], ["key ctrl+backspace"], "Deleted the last word."),
    (["go to the start of the line"], ["key home"], "Done."),
    (["go to the end of the line"], ["key end"], "Done."),
    (["switch windows", "switch to the other window", "alt tab"], ["key alt+tab"], "Switched windows."),
    (["show the desktop", "minimise everything", "minimize all windows"], ["key win+d"], "Here's the desktop."),
    (["open the start menu", "start menu"], ["key win"], "The Start menu is open."),
    (["open emoji panel", "insert an emoji"], ["key win+."], "The emoji panel is open."),
    (["open clipboard history", "show clipboard history"], ["key win+v"], "Clipboard history is open."),
    (["snip a part of the screen", "screen snip", "take a partial screenshot"], ["key win+shift+s"], "Draw a box around what you want."),
    (["lock my screen now"], ["key win+l"], "Locked."),
    (["open file explorer", "open my files", "open this pc"], ["key win+e"], "File Explorer is open."),
    (["open run dialog"], ["key win+r"], "The Run box is open."),
    (["open task view", "show all windows"], ["key win+tab"], "Here are all your windows."),
    (["snap this window left", "move window to the left"], ["key win+left"], "Snapped left."),
    (["snap this window right", "move window to the right"], ["key win+right"], "Snapped right."),
    (["maximise this window", "maximize this window", "make this window bigger"], ["key win+up"], "Maximised."),
    (["open action center", "open quick settings"], ["key win+a"], "Quick settings are open."),
    (["open notifications", "show notifications"], ["key win+n"], "Notifications are open."),
    (["start voice typing", "dictate", "voice typing"], ["key win+h"], "Voice typing is on; start speaking."),
    (["open the magnifier", "zoom the screen"], ["key win+plus"], "Magnifier is on."),
    (["close the magnifier"], ["key win+escape"], "Magnifier is off."),
    (["open narrator", "turn on narrator"], ["key ctrl+win+enter"], "Narrator toggled."),
    (["open task manager", "task manager"], ["key ctrl+shift+escape"], "Task Manager is open."),
    (["rename this file", "rename it"], ["key f2"], "Type the new name and press Enter."),
    (["open properties", "show properties"], ["key alt+enter"], "Properties are open."),
]
for phrases, steps, say in EDIT:
    for p in phrases:
        ex(p, steps, say)
for p in ["take a note {text}", "write {text} in notepad", "note down {text}", "make a note {text}", "jot down {text}"]:
    ex(p, ["open notepad", "wait 2", "type {text}"], "Noted.")
for p in ["type {text} here", "write {text} here", "type out {text}"]:
    ex(p, ["type {text}"], "Typed it.")
OFFICE = [("open a new word document", "winword", "Blank document"), ("new word file", "winword", "Blank document"), ("open a new excel sheet", "excel", "Blank workbook"),
          ("new spreadsheet", "excel", "Blank workbook"), ("open a new powerpoint", "powerpnt", "Blank Presentation"), ("new presentation", "powerpnt", "Blank Presentation")]
for t, app, blank in OFFICE:
    ex(t, ["open " + app, f"wait for \"{blank}\"", f"click \"{blank}\""], "A new file is open.")
for p in ["create a google doc called {name}", "new google doc {name}"]:
    ex(p, ["open https://docs.new", "wait for \"Untitled document\"", "click \"Untitled document\"", "key ctrl+a", "type {name}", "key enter"], "Created the Google Doc {name}.")
for p in ["create a google sheet called {name}", "new google sheet {name}"]:
    ex(p, ["open https://sheets.new", "wait for \"Untitled spreadsheet\"", "click \"Untitled spreadsheet\"", "key ctrl+a", "type {name}", "key enter"], "Created the Google Sheet {name}.")

SETTINGS = [("wifi", "network-wifi"), ("wi-fi", "network-wifi"), ("bluetooth", "bluetooth"), ("display", "display"), ("sound", "sound"), ("notifications", "notifications"), ("power", "powersleep"),
            ("battery", "batterysaver"), ("storage", "storagesense"), ("night light", "nightlight"), ("colours", "colors"), ("colors", "colors"), ("dark mode", "colors"), ("background", "personalization-background"),
            ("wallpaper", "personalization-background"), ("lock screen", "lockscreen"), ("themes", "themes"), ("fonts", "fonts"), ("start menu", "personalization-start"), ("taskbar", "taskbar"),
            ("apps", "appsfeatures"), ("default apps", "defaultapps"), ("startup apps", "startupapps"), ("accounts", "yourinfo"), ("sign in options", "signinoptions"), ("password", "signinoptions"),
            ("time", "dateandtime"), ("date and time", "dateandtime"), ("language", "regionlanguage"), ("keyboard", "keyboard"), ("typing", "typing"), ("mouse", "mousetouchpad"), ("touchpad", "devices-touchpad"),
            ("printers", "printers"), ("printer", "printers"), ("camera", "camera"), ("microphone", "privacy-microphone"), ("location", "privacy-location"), ("privacy", "privacy"), ("windows update", "windowsupdate"),
            ("update", "windowsupdate"), ("backup", "backup"), ("recovery", "recovery"), ("about this pc", "about"), ("system info", "about"), ("vpn", "network-vpn"), ("proxy", "network-proxy"),
            ("airplane mode", "network-airplanemode"), ("mobile hotspot", "network-mobilehotspot"), ("hotspot", "network-mobilehotspot"), ("ethernet", "network-ethernet"), ("accessibility", "easeofaccess"),
            ("magnifier", "easeofaccess-magnifier"), ("narrator", "easeofaccess-narrator"), ("text size", "easeofaccess-display"), ("mouse pointer", "easeofaccess-mousepointer"), ("captions", "easeofaccess-closedcaptioning"),
            ("multitasking", "multitasking"), ("clipboard", "clipboard"), ("focus", "quiethours"), ("do not disturb", "quiethours"), ("gaming", "gaming-gamebar"), ("windows security", "windowsdefender"),
            ("activation", "activation"), ("developer", "developers"), ("phone link", "mobile-devices"), ("volume mixer", "apps-volume")]
for name, page in SETTINGS:
    for p in ["open {n} settings", "go to {n} settings", "show {n} settings", "{n} settings"]:
        ex(p.format(n=name), ["open ms-settings:" + page], f"{name.title()} settings are open.")
TOGGLES = [("wifi", "network-wifi", "Wi-Fi"), ("bluetooth", "bluetooth", "Bluetooth"), ("airplane mode", "network-airplanemode", "Airplane mode"), ("mobile hotspot", "network-mobilehotspot", "Mobile hotspot"),
           ("battery saver", "batterysaver", "Battery saver"), ("location", "privacy-location", "Location services"), ("do not disturb", "quiethours", "Do not disturb")]
for word, page, switch in TOGGLES:
    for state, other in [("on", "Off"), ("off", "On")]:
        for p in [f"turn {state} {{w}}", f"switch {state} {{w}}", f"{{w}} {state}"]:
            ex(p.replace("{w}", word), ["open ms-settings:" + page, f"wait for \"{switch}\"", f"click \"{switch}\"", f"expect \"{'On' if state == 'on' else 'Off'}\""], f"{switch} is {state}.")
for state in ["on", "off"]:
    for p in [f"turn {state} night light", f"night light {state}"]:
        ex(p, ["open ms-settings:nightlight", "wait for \"Night light\"", f"click \"Turn {state} now\""], f"Night light is {state}.")
for p in ["set brightness to {level}", "brightness {level}", "make the screen brightness {level}", "change brightness to {level} percent"]:
    ex(p, ["run (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods) | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1;Brightness={level}}"], "Brightness set to {level}%.")
for t, lvl in [("make the screen brighter", 90), ("increase brightness", 85), ("make the screen dimmer", 30), ("decrease brightness", 35), ("full brightness", 100), ("lowest brightness", 10)]:
    ex(t, [f"run (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods) | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{{Timeout=1;Brightness={lvl}}}"], f"Brightness set to {lvl}%.")
for p in ["check for windows updates", "update windows", "are there any updates", "check for updates"]:
    ex(p, ["open ms-settings:windowsupdate", "wait for \"Check for updates\"", "click \"Check for updates\""], "Checking for updates.")
for p in ["change my wallpaper", "set a new wallpaper", "change the background"]:
    ex(p, ["open ms-settings:personalization-background"], "Background settings are open; pick a picture.")
for p in ["connect to wifi {name}", "join wifi {name}", "connect to the {name} network"]:
    ex(p, ["run netsh wlan connect name=\"{name}\""], "Connecting to {name}.")
for p in ["show available wifi networks", "list wifi networks", "which wifi networks are around"]:
    ex(p, ["run netsh wlan show networks"], "")

SYSINFO = [
    (["how much storage is left", "how much disk space do i have", "is my disk full", "free space on c drive"], "Get-PSDrive C | ForEach-Object { '{0:N1} GB free of {1:N1} GB' -f ($_.Free/1GB), (($_.Free+$_.Used)/1GB) }"),
    (["how much ram is being used", "check memory usage", "how much memory is free"], "$o=Get-CimInstance Win32_OperatingSystem; '{0:N1} GB free of {1:N1} GB' -f ($o.FreePhysicalMemory/1MB),($o.TotalVisibleMemorySize/1MB)"),
    (["what is my ip address", "show my public ip", "my ip"], "Invoke-RestMethod https://api.ipify.org"),
    (["what is my local ip", "show my local ip address"], "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' } | Select-Object -First 1).IPAddress"),
    (["how long has my pc been on", "show uptime", "when did my pc start"], "$b=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime; 'On since ' + $b"),
    (["which windows version do i have", "windows version", "what version of windows is this"], "(Get-CimInstance Win32_OperatingSystem).Caption + ' ' + (Get-CimInstance Win32_OperatingSystem).Version"),
    (["what processor do i have", "show my cpu", "cpu details"], "(Get-CimInstance Win32_Processor).Name"),
    (["what graphics card do i have", "show my gpu"], "(Get-CimInstance Win32_VideoController).Name -join ', '"),
    (["how much ram do i have", "total ram"], "'{0:N0} GB' -f ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB)"),
    (["which apps use the most memory", "what is using my ram", "top memory apps"], "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 6 Name,@{n='MB';e={[int]($_.WorkingSet64/1MB)}} | Format-Table -AutoSize | Out-String"),
    (["which apps use the most cpu", "what is slowing my pc", "top cpu apps"], "Get-Process | Sort-Object CPU -Descending | Select-Object -First 6 Name,CPU | Format-Table -AutoSize | Out-String"),
    (["battery health report", "check battery health", "generate a battery report"], "powercfg /batteryreport /output \"$env:USERPROFILE\\Desktop\\battery-report.html\"; Start-Process \"$env:USERPROFILE\\Desktop\\battery-report.html\"; 'Opened the battery report'"),
    (["what is my wifi name", "which wifi am i connected to", "current wifi network"], "(netsh wlan show interfaces) -match '^\\s+SSID' -replace '.*:\\s*',''"),
    (["is the internet working", "check my internet", "am i online"], "if (Test-Connection 8.8.8.8 -Count 2 -Quiet) { 'Internet is working' } else { 'No internet connection' }"),
    (["list installed apps", "what apps are installed", "show installed programs"], "winget list --accept-source-agreements | Select-Object -First 40 | Out-String"),
    (["what is my computer name", "pc name"], "$env:COMPUTERNAME"),
    (["who is logged in", "what is my username"], "$env:USERNAME"),
    (["show the time zone", "what is my time zone"], "(Get-TimeZone).DisplayName"),
    (["show my screen resolution", "what is my screen resolution"], "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Size"),
    (["empty temp files", "clear temporary files", "clean temp folder"], "Remove-Item \"$env:TEMP\\*\" -Recurse -Force -ErrorAction SilentlyContinue; 'Temporary files cleared'"),
    (["flush dns", "reset dns cache"], "ipconfig /flushdns"),
    (["restart the wifi adapter", "reset my network adapter"], "Get-NetAdapter | Where-Object Status -eq 'Up' | Restart-NetAdapter; 'Network adapter restarted'"),
    (["show startup programs", "what starts with windows"], "Get-CimInstance Win32_StartupCommand | Select-Object Name,Command | Format-Table -AutoSize | Out-String"),
    (["check disk health", "is my disk healthy"], "Get-PhysicalDisk | Select-Object FriendlyName,HealthStatus,MediaType | Format-Table -AutoSize | Out-String"),
    (["how many files are in my downloads", "count my downloads"], "(Get-ChildItem \"$env:USERPROFILE\\Downloads\" -File).Count"),
    (["how big is my downloads folder", "size of downloads"], "'{0:N1} GB' -f ((Get-ChildItem \"$env:USERPROFILE\\Downloads\" -Recurse -File | Measure-Object Length -Sum).Sum/1GB)"),
    (["show my recent downloads", "what did i download recently", "latest downloads"], "Get-ChildItem \"$env:USERPROFILE\\Downloads\" | Sort-Object LastWriteTime -Descending | Select-Object -First 8 Name | Out-String"),
    (["show recent files", "what files did i open recently"], "Get-ChildItem \"$env:APPDATA\\Microsoft\\Windows\\Recent\" | Sort-Object LastWriteTime -Descending | Select-Object -First 10 Name | Out-String"),
    (["what is the weather outside", "weather right now"], "(Invoke-RestMethod 'https://wttr.in/?format=3')"),
    (["how many updates are pending", "pending windows updates"], "(New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher().Search('IsInstalled=0').Updates.Count"),
]
for phrases, cmd in SYSINFO:
    for p in phrases:
        ex(p, ["run " + cmd], "")
for p in ["update all my apps", "upgrade all apps", "update every app", "update my software"]:
    ex(p, ["run winget upgrade --all --accept-source-agreements --accept-package-agreements --disable-interactivity"], "All apps are updated.")
APPS = [("vlc", "VideoLAN.VLC"), ("zoom", "Zoom.Zoom"), ("google chrome", "Google.Chrome"), ("chrome", "Google.Chrome"), ("firefox", "Mozilla.Firefox"), ("brave", "Brave.Brave"),
        ("whatsapp", "9NKSQGP7F2NH"), ("telegram", "Telegram.TelegramDesktop"), ("spotify", "Spotify.Spotify"), ("discord", "Discord.Discord"), ("skype", "Microsoft.Skype"),
        ("microsoft teams", "Microsoft.Teams"), ("teams", "Microsoft.Teams"), ("vs code", "Microsoft.VisualStudioCode"), ("visual studio code", "Microsoft.VisualStudioCode"), ("notepad++", "Notepad++.Notepad++"),
        ("7zip", "7zip.7zip"), ("7-zip", "7zip.7zip"), ("winrar", "RARLab.WinRAR"), ("adobe reader", "Adobe.Acrobat.Reader.64-bit"), ("acrobat reader", "Adobe.Acrobat.Reader.64-bit"),
        ("libreoffice", "TheDocumentFoundation.LibreOffice"), ("python", "Python.Python.3.12"), ("git", "Git.Git"), ("node", "OpenJS.NodeJS.LTS"), ("nodejs", "OpenJS.NodeJS.LTS"),
        ("java", "EclipseAdoptium.Temurin.21.JDK"), ("obs", "OBSProject.OBSStudio"), ("obs studio", "OBSProject.OBSStudio"), ("audacity", "Audacity.Audacity"), ("gimp", "GIMP.GIMP"),
        ("paint.net", "dotPDN.PaintDotNet"), ("blender", "BlenderFoundation.Blender"), ("steam", "Valve.Steam"), ("epic games", "EpicGames.EpicGamesLauncher"), ("anydesk", "AnyDeskSoftwareGmbH.AnyDesk"),
        ("teamviewer", "TeamViewer.TeamViewer"), ("google drive", "Google.GoogleDrive"), ("dropbox", "Dropbox.Dropbox"), ("onedrive", "Microsoft.OneDrive"), ("powertoys", "Microsoft.PowerToys"),
        ("windows terminal", "Microsoft.WindowsTerminal"), ("everything search", "voidtools.Everything"), ("sharex", "ShareX.ShareX"), ("greenshot", "Greenshot.Greenshot"), ("kindle", "Amazon.Kindle"),
        ("evernote", "Evernote.Evernote"), ("notion", "Notion.Notion"), ("obsidian", "Obsidian.Obsidian"), ("signal", "OpenWhisperSystems.Signal"), ("handbrake", "HandBrake.HandBrake"),
        ("k-lite codec pack", "CodecGuide.K-LiteCodecPack.Standard"), ("malwarebytes", "Malwarebytes.Malwarebytes"), ("ccleaner", "Piriform.CCleaner"), ("cpu-z", "CPUID.CPU-Z"), ("hwinfo", "REALiX.HWiNFO"),
        ("crystaldiskinfo", "CrystalDewWorld.CrystalDiskInfo"), ("qbittorrent", "qBittorrent.qBittorrent"), ("calibre", "calibre.calibre"), ("foxit reader", "Foxit.FoxitReader"), ("ollama", "Ollama.Ollama")]
for name, wid in APPS:
    for p in ["install {a}", "download and install {a}", "get {a} on my pc", "set up {a}"]:
        ex(p.format(a=name), [f"run winget install --id {wid} -e --accept-source-agreements --accept-package-agreements --disable-interactivity"], f"{name} is installed.")
for p in ["uninstall {app}", "remove the app {app}", "delete the program {app}"]:
    ex(p, ["run winget uninstall --name \"{app}\" --disable-interactivity"], "Uninstalled {app}.")

FILES = [
    (["create a folder called {name} on the desktop", "make a new folder {name} on desktop", "new desktop folder {name}"], "New-Item -ItemType Directory -Path \"$([Environment]::GetFolderPath('Desktop'))\\{name}\" -Force | Out-Null; 'Created'", "Created the folder {name} on your desktop."),
    (["create a folder called {name} in documents", "make a folder {name} in documents"], "New-Item -ItemType Directory -Path \"$([Environment]::GetFolderPath('MyDocuments'))\\{name}\" -Force | Out-Null; 'Created'", "Created the folder {name} in Documents."),
    (["open the folder {name}", "show me the {name} folder", "open my {name} folder"], "$f = Get-ChildItem -Path $env:USERPROFILE -Directory -Recurse -Depth 3 -Filter '*{name}*' -ErrorAction SilentlyContinue | Select-Object -First 1; if ($f) { Start-Process $f.FullName; $f.FullName } else { 'not found' }", ""),
    (["find the file {name}", "where is the file {name}", "search my pc for {name}"], "Get-ChildItem -Path $env:USERPROFILE -Recurse -File -Depth 6 -Filter '*{name}*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5 FullName | Out-String", ""),
    (["open the file {name}", "open my {name} file"], "$f = Get-ChildItem -Path $env:USERPROFILE -Recurse -File -Depth 6 -Filter '*{name}*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($f) { Start-Process $f.FullName; $f.Name } else { 'not found' }", ""),
    (["zip the folder {name}", "compress the folder {name}", "make a zip of {name}"], "$f = Get-ChildItem -Path $env:USERPROFILE -Directory -Recurse -Depth 3 -Filter '{name}' -ErrorAction SilentlyContinue | Select-Object -First 1; Compress-Archive -Path $f.FullName -DestinationPath \"$($f.FullName).zip\" -Force; \"$($f.FullName).zip\"", "Zipped {name}."),
    (["move my latest download to the desktop", "move the last download to desktop"], "$f = Get-ChildItem \"$env:USERPROFILE\\Downloads\" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1; Move-Item $f.FullName ([Environment]::GetFolderPath('Desktop')); $f.Name", "Moved it to the desktop."),
    (["open the latest download", "open the last thing i downloaded", "open my newest download"], "$f = Get-ChildItem \"$env:USERPROFILE\\Downloads\" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1; Start-Process $f.FullName; $f.Name", "Opened your latest download."),
    (["show my pdf files", "list my pdfs", "find all my pdfs"], "Get-ChildItem -Path $env:USERPROFILE -Recurse -File -Depth 5 -Filter *.pdf -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 10 Name | Out-String", ""),
    (["show my photos from today", "photos i took today"], "Get-ChildItem -Path ([Environment]::GetFolderPath('MyPictures')) -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime.Date -eq (Get-Date).Date } | Select-Object -First 15 Name | Out-String", ""),
    (["find big files", "what is taking up space", "largest files on my pc"], "Get-ChildItem -Path $env:USERPROFILE -Recurse -File -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 10 @{n='GB';e={[math]::Round($_.Length/1GB,2)}},FullName | Out-String", ""),
    (["copy the file {name} to the desktop", "copy {name} to desktop"], "$f = Get-ChildItem -Path $env:USERPROFILE -Recurse -File -Depth 6 -Filter '*{name}*' -ErrorAction SilentlyContinue | Select-Object -First 1; Copy-Item $f.FullName ([Environment]::GetFolderPath('Desktop')); $f.Name", "Copied {name} to the desktop."),
    (["open the desktop folder", "show desktop files"], "Start-Process ([Environment]::GetFolderPath('Desktop')); 'Opened'", "Opened the desktop folder."),
    (["open the documents folder", "show my documents"], "Start-Process ([Environment]::GetFolderPath('MyDocuments')); 'Opened'", "Opened Documents."),
    (["open the pictures folder", "show my pictures"], "Start-Process ([Environment]::GetFolderPath('MyPictures')); 'Opened'", "Opened Pictures."),
    (["open the music folder", "show my music folder"], "Start-Process ([Environment]::GetFolderPath('MyMusic')); 'Opened'", "Opened Music."),
    (["open the videos folder", "show my videos folder"], "Start-Process ([Environment]::GetFolderPath('MyVideos')); 'Opened'", "Opened Videos."),
    (["open the recycle bin", "show the recycle bin"], "Start-Process shell:RecycleBinFolder; 'Opened'", "Opened the Recycle Bin."),
]
for phrases, cmd, say in FILES:
    for p in phrases:
        ex(p, ["run " + cmd], say)

STUDY = [
    (["open {book} solutions on knowledgeboat", "{book} knowledgeboat solutions", "knowledgeboat {book}"], ["open https://www.google.com/search?q=site%3Aknowledgeboat.com+{book:url}", "click \"KnowledgeBoat\""], "Here are the {book} solutions."),
    (["ncert solutions for {book}", "{book} ncert solutions"], ["open https://www.google.com/search?q=ncert+solutions+{book:url}"], "Here are NCERT solutions for {book}."),
    (["open khan academy {topic}", "learn {topic} on khan academy"], ["open https://www.khanacademy.org/search?page_search_query={topic:url}"], "Here's {topic} on Khan Academy."),
    (["notes on {topic}", "short notes for {topic}", "revision notes {topic}"], ["open https://www.google.com/search?q={topic:url}+notes"], "Here are notes on {topic}."),
    (["previous year papers for {exam}", "{exam} previous year papers", "{exam} question papers"], ["open https://www.google.com/search?q={exam:url}+previous+year+question+papers+pdf"], "Here are {exam} papers."),
    (["{exam} syllabus", "syllabus for {exam}"], ["open https://www.google.com/search?q={exam:url}+syllabus"], "Here's the {exam} syllabus."),
    (["{exam} result", "check {exam} result", "{exam} results"], ["open https://www.google.com/search?q={exam:url}+result"], "Here's the {exam} result page."),
    (["practice {topic} questions", "quiz on {topic}", "mcq on {topic}"], ["open https://www.google.com/search?q={topic:url}+mcq+questions"], "Here are {topic} questions."),
    (["solve {problem}", "how to solve {problem}", "steps to solve {problem}"], ["open https://www.google.com/search?q=solve+{problem:url}"], "Here's how to solve {problem}."),
    (["learn {skill} for free", "free course on {skill}", "{skill} course"], ["open https://www.youtube.com/results?search_query={skill:url}+full+course"], "Here are free {skill} courses."),
    (["{topic} formulas", "formulas for {topic}", "formula sheet {topic}"], ["open https://www.google.com/search?q={topic:url}+formulas"], "Here are {topic} formulas."),
    (["{topic} diagram", "diagram of {topic}", "labelled diagram of {topic}"], ["open https://www.google.com/search?tbm=isch&q={topic:url}+diagram"], "Here are diagrams of {topic}."),
]
for phrases, steps, say in STUDY:
    for p in phrases:
        ex(p, steps, say)

SAATHI = [
    (["what medicines do i take today", "my medicine schedule", "which tablets today"], ["saathi get_medication_schedule {}"]),
    (["i took my medicine", "i have taken my tablets", "mark my medicine as taken"], ["saathi confirm_medication_taken {}"]),
    (["any messages from family", "read my family messages", "did my family write"], ["saathi get_family_messages {}"]),
    (["what appointments do i have", "my doctor visits", "upcoming appointments"], ["saathi get_upcoming_appointments {}"]),
    (["i need help", "call my family for help", "ask my family for help"], ["saathi ask_family_for_help {}"]),
    (["i got a suspicious call", "report a scam call", "someone called asking for my otp"], ["saathi report_suspicious_call {}"]),
    (["daily check in", "check in for today", "i am fine today"], ["saathi daily_check_in {}"]),
    (["family summary", "how is my family", "news from the family"], ["saathi family_summary {}"]),
]
for phrases, steps in SAATHI:
    for p in phrases:
        ex(p, steps, "")
for p in ["where did i keep my {thing}", "where is my {thing}", "find my {thing} at home"]:
    ex(p, ["saathi where_is {\"item\": \"{thing}\"}"], "")
for p in ["tell my family {message}", "send my family a message {message}", "let my family know {message}"]:
    ex(p, ["saathi send_message_to_family {\"text\": \"{message}\"}"], "Sent to your family.")

LESSONS = [
    "Amazon and Flipkart product links usually open in a new tab; after clicking a product the product page is the window in front.",
    "On Amazon, the site's own search box is called Search Amazon; never type product searches into the browser's address bar.",
    "Amazon price filters in links are in paise: add two zeros to the rupee amount, so 30,000 to 40,000 rupees is rh=p_36%3A3000000-4000000.",
    "Confirm adding to a cart with new words like Added to Cart, never with a cart count that was already on the page.",
    "Never press Buy Now, Place Order or Proceed to Pay without the user saying so.",
    "When choosing a product, prefer 4 stars or more with many reviews, skip Sponsored results, and say the price you saw.",
    "Flipkart shows a login pop-up first; press escape or click its close button.",
    "Myntra and Ajio call the cart a bag: look for ADD TO BAG and GO TO BAG.",
    "Many shops need a size or colour chosen before Add to Cart works; pick the one the user asked for, or ask.",
    "WhatsApp Web needs a one-time QR login on the phone; if the QR code is showing, tell the user to scan it.",
    "In WhatsApp Web, after typing a name in Search, click the contact under Chats, not the search box.",
    "YouTube: play and pause only with media play and media pause; never press k or click the video to toggle.",
    "For full screen video on YouTube press f after the video is in front; escape leaves full screen.",
    "After opening any video or song, add sound on and skip ads.",
    "On YouTube results, click the video title text, not the channel name or the thumbnail menu.",
    "Spotify Web needs the user to be logged in; if a Log in button shows, tell them.",
    "Netflix, Hotstar and Prime Video need a profile chosen first; click the user's profile if the Who's watching screen shows.",
    "Use direct links (search pages, ms-settings pages, Gmail compose links) instead of clicking through menus.",
    "Close cookie banners and sign-in nags (Not now, Maybe later, No thanks, Accept) before anything else.",
    "If something is not visible, scroll down and look again before deciding it is missing.",
    "Tabs close with ctrl+w; apps close with alt+f4 after focusing them. Never close Program Manager or Windows system windows.",
    "Typing goes where the cursor is: click the box first, then type.",
    "After a search, click the result's title words, not the address bar or the tab.",
    "expect must name words that appear only after success, never symbols like ₹ alone.",
    "For files, folders and system information use run with PowerShell instead of clicking in File Explorer.",
    "Ask before deleting files, uninstalling apps, shutting down or restarting the computer.",
    "Never type passwords, OTPs, card or bank details unless the user gave them for this task.",
    "Prices and specs change: when comparing products use research and fetch, then give the best three with reasons.",
    "If a page is still loading, wait for words that will appear rather than clicking blindly.",
    "Windows settings switches are named after the setting (Wi-Fi, Bluetooth); click it and expect On or Off.",
    "Gmail compose link: https://mail.google.com/mail/?view=cm&fs=1&to=ADDRESS&su=SUBJECT&body=TEXT.",
    "Google Maps directions link: https://www.google.com/maps/dir/?api=1&destination=PLACE.",
    "Edge opens a URL with open msedge followed by the link; Chrome with open chrome followed by the link.",
    "When the user corrects you, follow the correction exactly and remember it as a lesson.",
    "If the same step failed twice, try a different way: another word on screen, the keyboard, a direct link or a search.",
    "Keep replies to one short sentence; say what was done and anything the user must do next.",
    "Install apps with winget using the exact package id when you know it; winget install --id ID -e.",
    "Bank, tax and government sites log users out quickly; if a login page shows, stop and tell the user.",
    "IRCTC, banks and payment pages may show a captcha; never try to solve it, ask the user.",
    "Google Docs and Sheets: docs.new and sheets.new create a new file instantly.",
    "When the user says 'it' or 'this', they mean what is on screen or what was just done.",
    "If the user says 'close everything', close their apps one by one but never Sahay or Windows itself.",
    "A word typed in a search box also shows on screen; do not treat it as proof the search worked.",
    "Prefer the official website or app result over blogs and ads when opening something.",
    "Videos often start with an ad; skip ads waits for the Skip button and clicks it.",
    "Pages in other languages: use Google Translate links or the browser's translate prompt.",
    "If a download starts, wait for it to finish before opening the file.",
    "Online forms: click each box by its label, type, then press tab; check required fields marked with a star.",
    "Delivery addresses and payment methods are personal: ask the user before choosing them.",
    "When asked to choose, compare and explain briefly, then wait for the user's pick before acting.",
    "Elderly users may type with mistakes; guess the intended site or app sensibly and say what you opened.",
    "If the screen is locked or asleep, nothing can be clicked; tell the user to unlock it.",
    "Pop-up permission prompts (notifications, location) can usually be dismissed with Block or Not now.",
    "Use media next and media previous for playlists instead of hunting for buttons.",
    "To read a long page, use read and summarise it instead of scrolling and describing each part.",
    "For research questions, use research first and fetch the most relevant result before answering.",
    "Maps distance and time change with traffic; give them as approximate.",
    "Do not open more tabs than needed; reuse the current tab when continuing the same task.",
    "When a site asks to install its app, choose to continue in the browser.",
    "For printing, open the print window with ctrl+p and let the user check the printer and pages.",
    "Lock the PC with key win+l when the user steps away and asks to lock it.",
    "Battery saver and brightness are in ms-settings:batterysaver and the brightness command.",
    "Windows Update can take long; start the check and tell the user it continues in the background.",
    "For a Google search, open the search link with the words; do not click Google's search box.",
    "On Wikipedia, open Special:Search with go=Go to land directly on the article.",
    "News, scores and prices are live: open the search or site and read what it shows now.",
    "If an expected word never appears, read the screen and look for an error message before retrying.",
    "Use clipboard to read what the user copied, and type to paste short text where the cursor is.",
    "File names may differ from what the user says; search with part of the name.",
    "For shopping lists, add items one by one and report which were added and which were not found.",
    "Never accept terms, subscriptions or free trials on the user's behalf.",
    "Open links in the browser the user prefers when they have said which one.",
    "Do not log out of accounts or change account settings unless asked.",
    "When a site shows 'Are you a robot?', stop and ask the user to complete it.",
    "Respect quiet hours: avoid playing loud media late at night unless asked.",
    "Speak simply and kindly; the user may be elderly or new to computers.",
    "When the task is done, stop; do not add extra actions the user did not ask for.",
    "If two buttons look alike, prefer the one inside the page, not the browser toolbar.",
    "A product's title on the results page usually matches its words in the request; click those words.",
    "When nothing on screen matches, try research or a direct search link instead of guessing positions.",
    "For local businesses near the user, use Google Maps search with 'near me'.",
    "For government services, open the official .gov.in site.",
    "To share a page, copy its link with ctrl+l then ctrl+c.",
    "Spoken requests may lack punctuation; split them into steps sensibly.",
    "Short video platforms like Shorts and Reels autoplay; use media pause to stop them.",
    "For homework help, find a clear explanation or video rather than just the answer.",
    "Medicine information is for reference; always suggest checking with a doctor.",
    "If the user seems distressed or mentions an emergency, use saathi ask_family_for_help.",
    "Calls asking for OTPs or bank details are scams; use saathi report_suspicious_call.",
    "Time-sensitive tasks (trains, flights) need the date; ask if it is missing.",
    "Recipes and how-to requests are best answered with a YouTube video.",
    "If audio does not play, check volume and mute with sound on before anything else.",
    "Close only the tabs the user named; keep the rest.",
    "After installing an app, it can be opened with open and its name.",
    "If the user asks to undo, use ctrl+z or reverse the last action exactly.",
    "When a list is long, mention the top few and offer more.",
    "Respect the user's language: reply in the language they wrote in.",
    "Save the user's preferences with remember so you don't ask again.",
    "Use E/T numbers only from the newest screen; describe targets by words otherwise.",
    "If the window in front is not the one you need, focus it by part of its title first.",
]
for l in LESSONS:
    lesson(l)

if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "sahay-massive.jsonl"
    with open(path, "w", encoding="utf-8") as f:
        for item in out:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
    tasks = sum(1 for i in out if "task" in i)
    templates = sum(1 for i in out if "task" in i and "{" in i["task"])
    print(f"{len(out)} lines: {tasks} tasks ({templates} templates), {len(out) - tasks} lessons")


def mega():
    def fill(item, values):
        task = item["task"]
        steps = item["steps"]
        say = item["say"]
        for k, v in values.items():
            enc = "+".join(v.split())
            task = task.replace("{" + k + "}", v)
            steps = [s.replace("{" + k + ":url}", enc).replace("{" + k + "}", v) for s in steps]
            say = say.replace("{" + k + "}", v)
        return task, steps, say

    templates = {i["task"]: i for i in out if "task" in i and "{" in i["task"]}

    def use(template, values):
        t = templates.get(template)
        if t:
            task, steps, say = fill(t, values)
            ex(task, steps, say)

    colors = ["black", "white", "blue", "red", "green", "grey", "pink", "brown", "navy", "beige", "yellow", "maroon", "purple", "orange", "olive", "silver"]
    things = ["umbrella", "water bottle", "backpack", "t-shirt", "kurta", "saree", "jeans", "sneakers", "sandals", "wallet", "watch", "phone cover", "lunch box", "bedsheet", "pillow cover",
              "towel", "jacket", "sweater", "cap", "socks", "school bag", "laptop sleeve", "yoga mat", "hoodie", "shirt", "salwar suit", "dupatta", "slippers", "raincoat", "handbag"]
    products = [f"{c} {t}" for c in colors for t in things]
    products += ["wireless mouse", "keyboard", "usb c cable", "phone charger", "power bank", "bluetooth speaker", "earbuds", "headphones", "smartwatch", "fitness band", "laptop stand", "webcam",
                 "pen drive", "hard disk", "memory card", "router", "extension board", "led bulb", "table lamp", "ceiling fan", "room heater", "air cooler", "electric kettle", "mixer grinder", "pressure cooker",
                 "non stick pan", "dinner set", "steel tiffin", "water purifier", "iron", "hair dryer", "trimmer", "toothbrush", "face wash", "shampoo", "sunscreen", "moisturiser", "notebook", "pen set", "geometry box",
                 "calculator", "school shoes", "football", "cricket bat", "badminton racket", "cycle", "helmet", "car charger", "phone holder", "tv remote", "batteries", "torch", "mosquito racket", "first aid kit",
                 "blood pressure monitor", "thermometer", "pulse oximeter", "walking stick", "reading glasses", "hearing aid batteries", "diabetic socks", "pill organiser", "knee support", "hot water bag",
                 "almonds", "green tea", "honey", "atta", "basmati rice", "toor dal", "ghee", "olive oil", "coffee", "biscuits", "dry fruits", "jaggery", "masala box", "detergent", "dishwash liquid"]
    stores = ["amazon", "flipkart", "myntra", "ajio", "nykaa", "croma", "jiomart", "bigbasket", "1mg", "meesho"]
    add_phr = ["add {item} to my {s} cart", "put {item} in my {s} cart", "buy {item} on {s}", "order {item} from {s}"]
    find_phr = ["find {q} on {s}", "search {q} on {s}"]
    for p in products:
        for s in stores:
            for ph in add_phr:
                use(ph.replace("{s}", s), {"item": p})
            for ph in find_phr:
                use(ph.replace("{s}", s), {"q": p})
    gadgets = ["phone", "laptop", "tablet", "smart tv", "earbuds", "smartwatch", "refrigerator", "washing machine", "air conditioner", "microwave", "camera", "printer", "monitor", "speaker", "air purifier"]
    ranges = [(5000, 10000), (10000, 15000), (15000, 20000), (20000, 30000), (30000, 40000), (40000, 50000), (50000, 70000), (70000, 100000)]
    for g in gadgets:
        for lo, hi in ranges:
            use("find {item} between {min} and {max} on amazon", {"item": g, "min": str(lo), "max": str(hi)})
            use("find {item} between {min} and {max} on flipkart", {"item": g, "min": str(lo), "max": str(hi)})
            use("best {item} under {price}", {"item": g, "price": str(hi)})
            use("find {item} on amazon under {price}", {"item": g, "price": str(hi)})
        for sort in ["best rated", "cheapest", "newest"]:
            use(f"find the {sort} {{item}} on amazon", {"item": g})
        use("reviews of {item}", {"item": g})
    names = ["Ravi", "Asha", "Sunita", "Rahul", "Priya", "Amit", "Neha", "Vikram", "Pooja", "Arjun", "Kavya", "Rohan", "Sneha", "Anil", "Meena", "Suresh", "Geeta", "Raju", "Lakshmi", "Deepak",
             "Anjali", "Manoj", "Rekha", "Sanjay", "Nisha", "Vijay", "Shalini", "Ajay", "Divya", "Karan", "Mom", "Dad", "Papa", "Mummy", "Didi", "Bhaiya", "Nani", "Dadi", "Chachu", "Mama",
             "Beta", "Akshat", "Riya", "Aarav", "Ishaan", "Tanvi", "Harish", "Usha", "Kamla", "Gopal", "Savitri", "Ramesh", "Shanti", "Mohan", "Radha", "Krishna", "Sita", "Hari", "Parvati", "Ganesh"]
    msgs = ["Good morning", "Good night", "Happy birthday", "Happy anniversary", "Happy Diwali", "Happy Holi", "Eid Mubarak", "Merry Christmas", "Happy New Year", "I reached home safely",
            "I will call you later", "Call me when you are free", "I am on the way", "Running late, sorry", "Have you eaten", "Take care", "Get well soon", "Congratulations", "Thank you so much",
            "Miss you", "Love you", "See you tomorrow", "Where are you", "What time is the function", "Please send the photos", "Did you take your medicine", "The doctor appointment is at 5",
            "I am at the hospital", "I am fine, don't worry", "Bring milk on the way", "The electricity is gone", "Please call the plumber", "Pay the electricity bill", "I sent the money",
            "Check your email", "Meeting at 4 pm", "Happy Raksha Bandhan", "Jai Shri Krishna", "Ram Ram", "Sat Sri Akal",
            "Happy Navratri", "Happy Pongal", "Happy Onam", "Happy Teachers Day", "Happy Mothers Day", "Happy Fathers Day", "Best of luck for your exam", "Well done", "Proud of you",
            "Please come home early", "Dinner is ready", "I am waiting outside", "Send me the address", "Share your location", "The parcel has arrived", "Please recharge my phone",
            "Can you help me", "I need to talk to you", "Are you coming today", "Let's meet this weekend"]
    for n in names:
        for m in msgs:
            use("send {message} to {name} on whatsapp", {"message": m, "name": n})
    for n in names:
        for t in ["open whatsapp chat with {name}", "tell my family {message}"][:1]:
            use(t, {"name": n})
    mails = ["meena@example.com", "rahul.s@example.com", "accounts@example.com", "school@example.com", "clinic@example.com", "landlord@example.com", "travel@example.com", "insurance@example.com",
             "editor@example.com", "team@example.com", "asha@example.com", "ravi.kumar@example.com", "office@example.com", "hr@example.com", "principal@example.com", "doctor@example.com", "bank.support@example.com", "teacher@example.com",
             "sales@example.com", "support@example.com"]
    bodies = ["I reached safely", "Please find the documents attached", "I will be on leave tomorrow", "Thank you for your help", "Can we meet on Monday", "Please call me back",
              "The payment is done", "I need an appointment", "Happy birthday", "Here is my report"]
    for a in mails:
        for b in bodies:
            use("send an email to {email} saying {body}", {"email": a, "body": b})
            use("draft an email to {email} about {subject}", {"email": a, "subject": b})
    cities = ["Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad", "Jaipur", "Lucknow", "Kanpur", "Nagpur", "Indore", "Bhopal", "Patna", "Vadodara", "Surat",
              "Ludhiana", "Agra", "Nashik", "Varanasi", "Amritsar", "Chandigarh", "Coimbatore", "Kochi", "Thiruvananthapuram", "Mysuru", "Mangaluru", "Visakhapatnam", "Vijayawada", "Madurai", "Guwahati",
              "Bhubaneswar", "Ranchi", "Raipur", "Dehradun", "Shimla", "Manali", "Rishikesh", "Haridwar", "Udaipur", "Jodhpur", "Goa", "Puducherry", "Ooty", "Darjeeling", "Gangtok", "Srinagar", "Leh",
              "Aurangabad", "Kolhapur", "Nanded", "Jabalpur", "Gwalior", "Allahabad", "Meerut", "Noida", "Gurugram", "Faridabad", "Thane", "Navi Mumbai", "Rajkot", "Jamnagar", "Ajmer", "Bikaner",
              "Tirupati", "Shirdi", "Mathura", "Vrindavan", "Ayodhya", "Dubai", "London", "New York", "Singapore", "Toronto", "Sydney", "Bangkok", "Kathmandu", "Paris", "Tokyo"]
    for c in cities:
        for t in ["directions to {place}", "show {place} on the map", "where is {place}", "how far is {place}", "route to {place}", "navigate to {place}"]:
            use(t, {"place": c})
        for t in ["hotels in {w}", "things to do in {w}", "time in {w}", "movies in {w}", "news about {w}"]:
            use(t, {"w": c})
    for i, a in enumerate(cities[:75]):
        for b in cities[i + 1:i + 14]:
            use("directions from {a} to {b}", {"a": a, "b": b})
            use("trains from {a} to {b}", {"a": a, "b": b})
            use("flights from {a} to {b}", {"a": a, "b": b})
            use("buses from {a} to {b}", {"a": a, "b": b})
    words = ["serendipity", "nostalgia", "resilience", "gratitude", "empathy", "integrity", "ambiguous", "meticulous", "ephemeral", "eloquent", "pragmatic", "benevolent", "candid", "diligent", "frugal",
             "humble", "lucid", "notorious", "obsolete", "pristine", "quaint", "robust", "sincere", "tenacious", "vivid", "whimsical", "zealous", "abundant", "brave", "calm", "curious", "eager", "gentle",
             "honest", "joyful", "kind", "loyal", "patient", "proud", "wise", "hello", "thank you", "good morning", "how are you", "where is the hospital", "I am hungry", "water", "medicine", "doctor", "family",
             "friend", "happiness", "peace", "love", "school", "teacher", "book", "rain", "sun", "moon", "river", "mountain", "tree", "flower", "bird", "elephant", "tiger", "cow", "milk", "bread", "rice",
             "vegetables", "fruits", "market", "train", "bus", "car", "road", "house", "kitchen", "window", "door", "chair", "table", "bed", "clock", "phone", "computer", "money", "bank", "temple", "prayer",
             "festival", "wedding", "birthday", "music", "dance", "song", "story", "dream"]
    langs = ["{w} in hindi", "{w} in english", "translate {w} to marathi", "translate {w} to tamil", "translate {w} to bengali", "translate {w} to gujarati"]
    for w in words:
        for t in ["meaning of {w}", "synonym of {w}"] + langs:
            use(t, {"w": w})
    topics = ["photosynthesis", "gravity", "the solar system", "black holes", "the human heart", "the digestive system", "climate change", "the water cycle", "volcanoes", "earthquakes", "electricity",
              "magnetism", "atoms", "cells", "dna", "evolution", "the french revolution", "world war 2", "the mughal empire", "the indian constitution", "mahatma gandhi", "bhagat singh", "rabindranath tagore",
              "apj abdul kalam", "sardar patel", "subhas chandra bose", "rani lakshmibai", "chhatrapati shivaji", "akbar", "ashoka", "the taj mahal", "the red fort", "qutub minar", "the himalayas", "the ganges",
              "the indian ocean", "the amazon rainforest", "the sahara desert", "mount everest", "the moon landing", "isro", "chandrayaan 3", "mangalyaan", "nasa", "artificial intelligence", "machine learning",
              "the internet", "blockchain", "cryptocurrency", "upi", "the stock market", "inflation", "gst", "income tax", "mutual funds", "fixed deposits", "diabetes", "blood pressure", "arthritis",
              "yoga", "ayurveda", "meditation", "vitamin d", "protein", "cholesterol", "thyroid", "migraine", "dengue", "malaria", "covid 19", "vaccines", "the olympics", "cricket", "the ipl", "sachin tendulkar",
              "virat kohli", "ms dhoni", "pv sindhu", "neeraj chopra", "chess", "viswanathan anand", "bollywood", "satyajit ray", "lata mangeshkar", "kishore kumar", "ar rahman", "classical dance", "bharatanatyam",
              "kathak", "diwali", "holi", "eid", "christmas", "pongal", "onam", "durga puja", "ganesh chaturthi", "navratri", "raksha bandhan", "the ramayana", "the mahabharata", "the bhagavad gita", "buddhism",
              "jainism", "sikhism", "the vedas", "sanskrit", "pythagoras theorem", "algebra", "trigonometry", "calculus", "probability", "statistics", "fractions", "percentages", "simple interest",
              "compound interest", "the periodic table", "acids and bases", "chemical reactions", "newton's laws", "motion", "light", "sound", "heat", "nutrition", "the respiratory system", "the nervous system",
              "the skeletal system", "plants", "animals", "ecosystems", "pollution", "renewable energy", "solar power", "wind energy", "democracy", "elections in india", "the parliament", "the supreme court",
              "human rights", "the united nations", "the g20", "globalisation", "the industrial revolution", "the renaissance", "ancient egypt", "the roman empire", "the indus valley civilisation"]
    for t in topics:
        use("wikipedia page on {w}", {"w": t})
        use("{w} pdf", {"w": t})
        use("{topic} diagram", {"topic": t})
        use("{topic} formulas", {"topic": t})
        use("{w} wikipedia", {"w": t})
        use("explain {q} with a video", {"q": t})
        use("notes on {topic}", {"topic": t})
        use("images of {w}", {"w": t})
        use("quiz on {topic}", {"topic": t})
    dishes = ["masala chai", "dal makhani", "paneer butter masala", "butter chicken", "biryani", "rajma", "chole", "aloo paratha", "dosa", "idli", "sambar", "upma", "poha", "khichdi", "pulao",
              "palak paneer", "malai kofta", "gulab jamun", "rasgulla", "kheer", "halwa", "ladoo", "jalebi", "pav bhaji", "vada pav", "pani puri", "dhokla", "thepla", "misal pav", "pongal", "rasam",
              "appam", "fish curry", "egg curry", "mutton curry", "veg fried rice", "hakka noodles", "manchurian", "pasta", "pizza", "sandwich", "cake", "cookies", "smoothie", "lemonade", "lassi",
              "cold coffee", "tomato soup", "sprouts salad", "oats porridge", "ragi dosa", "besan chilla", "moong dal", "sabudana khichdi", "kadhi", "baingan bharta", "bhindi masala", "gobi manchurian",
              "dal tadka", "jeera rice"]
    for d in dishes:
        for t in ["recipe for {q}", "how to make {q}", "how to cook {q}", "{q} recipe"]:
            use(t, {"q": d})
    howtos = ["tie a tie", "fold a shirt", "make a paper boat", "do surya namaskar", "meditate", "use upi", "use whatsapp", "make a video call", "take a screenshot", "use google maps",
              "change my phone wallpaper", "reset my password", "use zoom", "make a pdf", "scan a document", "send a photo on whatsapp", "use google pay", "book a train ticket", "pay electricity bill online",
              "file income tax", "link aadhaar with pan", "update aadhaar address", "apply for a passport", "renew driving licence", "check credit score", "make a resume", "write a cover letter",
              "learn typing", "learn english speaking", "learn excel", "learn coding", "grow tomatoes at home", "care for a money plant", "clean a laptop screen", "speed up my laptop", "save phone battery",
              "remove a virus", "back up my phone", "use chatgpt", "make tea", "lose weight", "sleep better", "reduce stress", "improve memory", "do breathing exercises", "lower blood pressure naturally",
              "control sugar levels", "start running", "do pushups", "stretch after walking"]
    for h in howtos:
        use("how to {q}", {"q": h})
        use("show me how to {q}", {"q": h})
    songs = ["bella ciao", "kesariya", "tum hi ho", "channa mereya", "lag ja gale", "kal ho naa ho", "chaiyya chaiyya", "jai ho", "vande mataram", "hanuman chalisa", "gayatri mantra", "om namah shivaya",
             "achyutam keshavam", "raghupati raghav", "ae watan", "dil diyan gallan", "apna bana le", "pasoori", "srivalli", "naatu naatu", "kun faya kun", "tujh mein rab dikhta hai", "pehla nasha",
             "yeh dosti", "mere sapno ki rani", "kabhi kabhi mere dil mein", "tujhe dekha toh", "chura liya hai tumne", "ek pyar ka nagma hai", "ajeeb dastan hai yeh", "piya tose naina lage", "teri mitti",
             "maa tujhe salaam", "chak de india", "zinda", "kar har maidan fateh", "lakshya", "badtameez dil", "gallan goodiyaan", "london thumakda", "nagada sang dhol", "ghoomar", "kala chashma",
             "lungi dance", "dilbar", "sheila ki jawani", "munni badnaam", "tum se hi", "agar tum saath ho", "raabta", "jeene laga hoon", "phir le aaya dil", "tera ban jaunga", "bekhayali", "kaise hua",
             "tum mile", "o saathi", "hawayein", "khairiyat", "shayad", "jhoome jo pathaan", "besharam rang", "chaleya", "heeriye", "satranga", "arjan vailly", "o maahi", "pehle bhi main", "tere vaaste",
             "shape of you", "believer", "despacito", "perfect", "blinding lights", "senorita", "faded", "see you again", "let her go", "counting stars", "calm down", "levitating", "heat waves", "unstoppable",
             "thunder", "hymn for the weekend", "yellow", "fix you", "viva la vida", "something just like this", "closer", "attention", "photograph", "thinking out loud", "all of me", "someone like you",
             "hello adele", "rolling in the deep", "bad guy", "lovely", "dynamite", "butter", "gangnam style", "waka waka", "macarena", "dance monkey", "stay", "peaches", "as it was", "flowers",
             "anti hero", "shake it off", "love story", "blank space", "cruel summer", "espresso"]
    for sg in songs:
        for t in ["play {q} on youtube", "play the song {q}", "play {q} on spotify", "youtube play {q}", "put on {q} on youtube", "play {q} video"]:
            use(t, {"q": sg})
    shows = ["sacred games", "mirzapur", "panchayat", "the family man", "kota factory", "scam 1992", "made in heaven", "delhi crime", "aspirants", "gullak", "money heist", "stranger things", "squid game",
             "the crown", "wednesday", "dark", "breaking bad", "friends", "the office", "game of thrones", "3 idiots", "dangal", "pk", "lagaan", "sholay", "dilwale dulhania le jayenge", "kabhi khushi kabhie gham",
             "zindagi na milegi dobara", "rrr", "baahubali", "kgf", "pushpa", "jawan", "pathaan", "animal", "12th fail", "laapataa ladies", "stree 2", "kalki 2898 ad", "jailer"]
    for sh in shows:
        use("watch {q} on netflix", {"q": sh})
        use("watch {q} on prime video", {"q": sh})
        use("watch {q} on hotstar", {"q": sh})
        use("search {q} on imdb", {"q": sh})
        use("search {q} on youtube", {"q": sh + " trailer"})
    stocks = ["reliance", "tcs", "infosys", "hdfc bank", "icici bank", "sbi", "itc", "hul", "bharti airtel", "wipro", "hcl tech", "tata motors", "tata steel", "adani enterprises", "asian paints",
              "maruti suzuki", "bajaj finance", "kotak bank", "axis bank", "larsen and toubro", "sun pharma", "titan", "nestle india", "ongc", "ntpc", "power grid", "coal india", "zomato", "paytm", "nykaa",
              "apple", "microsoft", "google", "amazon", "tesla", "nvidia", "meta", "netflix"]
    for st in stocks:
        use("{w} share price", {"w": st})
        use("news about {w}", {"w": st + " stock"})
    jobs = ["teacher", "nurse", "driver", "accountant", "data entry", "software developer", "graphic designer", "sales executive", "receptionist", "electrician", "plumber", "chef", "delivery partner",
            "customer support", "content writer", "digital marketing", "hr executive", "bank clerk", "pharmacist", "lab technician", "security guard", "tutor", "photographer", "beautician", "tailor"]
    for jb in jobs:
        use("jobs for {w}", {"w": jb})
        use("find {w} jobs", {"w": jb})
    specialities = ["cardiologist", "dermatologist", "orthopaedic", "dentist", "eye", "ent", "gynaecologist", "paediatrician", "neurologist", "psychiatrist", "physiotherapist", "diabetologist",
                    "general physician", "homeopathy", "ayurveda"]
    for sp in specialities:
        use("find a {w} doctor", {"w": sp})
        for c in cities[:12]:
            use("search {q} on practo", {"q": f"{sp} in {c}"})
    files = ["resume", "aadhaar", "pan card", "passport", "marksheet", "certificate", "salary slip", "bank statement", "invoice", "bill", "ticket", "report", "notes", "assignment", "project",
             "presentation", "photo", "receipt", "policy", "prescription", "lab report", "tax return", "rent agreement", "insurance", "warranty"]
    for f in files:
        for t in ["find the file {name}", "open the file {name}", "copy the file {name} to the desktop"]:
            use(t, {"name": f})
    medicines = ["paracetamol", "dolo 650", "crocin", "metformin", "amlodipine", "telmisartan", "atorvastatin", "pantoprazole", "cetirizine", "azithromycin", "amoxicillin", "ibuprofen", "aspirin",
                 "thyronorm", "glycomet", "ecosprin", "shelcal", "becosules", "limcee", "digene", "ors", "vicks", "volini", "moov", "combiflam"]
    for md in medicines:
        use("side effects of {w}", {"w": md})
        use("search {q} on 1mg", {"q": md})
        use("add {item} to my 1mg cart", {"item": md})
    for b in ["selina concise biology class 9", "selina concise physics class 10", "selina concise chemistry class 10", "ml aggarwal class 10 maths", "rs aggarwal class 8", "rd sharma class 10",
              "ncert class 10 science", "ncert class 9 maths", "ncert class 12 physics", "ncert class 11 chemistry", "icse class 10 english", "cbse class 12 accountancy", "total english class 9",
              "treasure trove class 10", "frank class 8 science", "s chand physics class 9", "lakhmir singh class 8", "arihant class 10 sample papers", "oswaal class 12 question bank", "together with class 9 science"]:
        use("open {book} solutions on knowledgeboat", {"book": b})
        use("ncert solutions for {book}", {"book": b})
        use("{w} pdf", {"w": b})
    for e in ["cbse class 10", "cbse class 12", "icse class 10", "isc class 12", "jee main", "jee advanced", "neet", "cuet", "upsc prelims", "ssc cgl", "bank po", "ctet", "gate", "cat", "clat", "nda"]:
        for t in ["previous year papers for {exam}", "{exam} syllabus", "{exam} result"]:
            use(t, {"exam": e})
    skills = ["python", "excel", "english speaking", "spoken hindi", "guitar", "drawing", "photography", "video editing", "public speaking", "accounting", "tally", "digital marketing", "web design",
              "java", "c programming", "data science", "machine learning", "cooking", "yoga", "typing"]
    for sk in skills:
        use("learn {skill} for free", {"skill": sk})
        use("search {q} on coursera", {"q": sk})
        use("search {q} on udemy", {"q": sk})
    for g in ["google", "bing", "duckduckgo", "reddit", "quora", "pinterest", "github", "stack overflow", "wikipedia", "google news", "google scholar", "archive"]:
        for t in topics:
            use("search {q} on " + g, {"q": t})


if __name__ == "__main__" and len(sys.argv) > 2 and sys.argv[2] == "--mega":
    mega()
    with open(sys.argv[1], "w", encoding="utf-8") as f:
        for item in out:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
    tasks = sum(1 for i in out if "task" in i)
    templates = sum(1 for i in out if "task" in i and "{" in i["task"])
    print(f"{len(out)} lines: {tasks} tasks ({templates} templates), {len(out) - tasks} lessons")
