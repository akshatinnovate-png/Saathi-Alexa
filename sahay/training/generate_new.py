import json
import os
import random
import sys

random.seed(42)
lines = []
templates = []
seen = set()


def add(task, steps, say=""):
    k = task.lower()
    if k in seen:
        return
    seen.add(k)
    lines.append({"task": task, "steps": steps, "say": say})


def template(task, steps, say=""):
    t = {"task": task, "steps": steps, "say": say}
    templates.append(t)
    return t


def slug(v):
    return "-".join(v.lower().replace("&", "and").replace("'", "").split())


def fill(t, values):
    task, steps, say = t["task"], list(t["steps"]), t["say"]
    for k, v in values.items():
        task = task.replace("{" + k + "}", v)
        say = say.replace("{" + k + "}", v)
        steps = [s.replace("{" + k + ":url}", "+".join(v.split())).replace("{" + k + ":slug}", slug(v)).replace("{" + k + "}", v) for s in steps]
    return task, steps, say


def use(t, values):
    task, steps, say = fill(t, values)
    add(task, steps, say)


CITIES = """Mumbai Delhi Bengaluru Hyderabad Chennai Kolkata Pune Ahmedabad Jaipur Lucknow Kanpur Nagpur Indore Bhopal Patna Vadodara Surat Ludhiana Agra Nashik Varanasi Amritsar Chandigarh Coimbatore
Kochi Thiruvananthapuram Mysuru Mangaluru Visakhapatnam Vijayawada Madurai Guwahati Bhubaneswar Ranchi Raipur Dehradun Shimla Manali Rishikesh Haridwar Udaipur Jodhpur Goa Puducherry Ooty Darjeeling
Gangtok Srinagar Jammu Leh Aurangabad Kolhapur Nanded Solapur Sangli Satara Ahmednagar Jalgaon Akola Amravati Latur Jabalpur Gwalior Ujjain Sagar Rewa Satna Allahabad Prayagraj Meerut Noida Ghaziabad
Gurugram Faridabad Thane Navi-Mumbai Kalyan Vasai Panvel Rajkot Jamnagar Bhavnagar Junagadh Gandhinagar Anand Bharuch Vapi Ajmer Bikaner Kota Alwar Bhilwara Sikar Udaipur-City Tirupati Nellore Guntur
Kurnool Kakinada Rajahmundry Warangal Karimnagar Nizamabad Khammam Salem Tiruchirappalli Tirunelveli Erode Vellore Thoothukudi Thanjavur Kanchipuram Hosur Hubli Dharwad Belagavi Kalaburagi Ballari
Davanagere Shivamogga Tumakuru Udupi Hassan Kozhikode Thrissur Kollam Kannur Alappuzha Palakkad Kottayam Malappuram Siliguri Durgapur Asansol Howrah Kharagpur Haldia Burdwan Cuttack Rourkela Berhampur
Sambalpur Puri Jamshedpur Dhanbad Bokaro Hazaribagh Deoghar Bilaspur Durg Bhilai Korba Gaya Bhagalpur Muzaffarpur Darbhanga Purnia Gorakhpur Bareilly Aligarh Moradabad Saharanpur Jhansi Mathura Vrindavan
Ayodhya Firozabad Muzaffarnagar Rampur Shahjahanpur Haldwani Roorkee Nainital Mussoorie Rudrapur Panipat Karnal Rohtak Hisar Sonipat Ambala Yamunanagar Bathinda Jalandhar Patiala Mohali Pathankot
Hoshiarpur Shillong Imphal Aizawl Agartala Kohima Itanagar Dibrugarh Silchar Jorhat Tezpur Port-Blair Daman Silvassa Panaji Margao Vasco Karwar Hampi Shirdi Pandharpur Lonavala Mahabaleshwar
Alibag Ratnagiri Kolar Chikmagalur Coorg Kodaikanal Munnar Wayanad Varkala Kanyakumari Rameswaram Pondicherry-Town Khajuraho Orchha Pachmarhi Mount-Abu Pushkar Jaisalmer Chittorgarh Bundi Ranthambore
Dharamshala McLeodganj Kasauli Dalhousie Kullu Spiti Auli Badrinath Kedarnath Gulmarg Pahalgam Sonmarg Katra Kurukshetra Bodh-Gaya Nalanda Rajgir Somnath Dwarka Kutch Bhuj Diu Saputara""".split()
CITIES = [c.replace("-", " ") for c in CITIES]

DISHES = """biryani|chicken biryani|veg biryani|mutton biryani|hyderabadi biryani|paneer butter masala|butter chicken|dal makhani|chole bhature|rajma chawal|kadhi chawal|aloo paratha|paneer paratha|gobi paratha|
masala dosa|plain dosa|rava dosa|mysore masala dosa|idli sambar|medu vada|uttapam|pongal|upma|poha|misal pav|vada pav|pav bhaji|pani puri|sev puri|bhel puri|dahi puri|samosa|kachori|aloo tikki|dhokla|khandvi|
thepla|undhiyu|dal baati churma|gatte ki sabzi|litti chokha|momos|chicken momos|veg momos|thukpa|chowmein|hakka noodles|veg fried rice|chicken fried rice|manchurian|gobi manchurian|chilli paneer|chilli chicken|
spring rolls|schezwan noodles|pizza|margherita pizza|paneer pizza|chicken pizza|burger|veg burger|chicken burger|french fries|sandwich|grilled sandwich|club sandwich|wrap|shawarma|chicken shawarma|kebab|
seekh kebab|tandoori chicken|chicken tikka|paneer tikka|malai tikka|fish fry|fish curry|prawn curry|egg curry|egg biryani|omelette|chicken curry|mutton curry|rogan josh|nihari|haleem|korma|keema|
kathi roll|egg roll|paneer roll|chicken roll|thali|veg thali|gujarati thali|rajasthani thali|south indian thali|punjabi thali|maharashtrian thali|bengali thali|fish thali|khichdi|curd rice|lemon rice|
tamarind rice|bisi bele bath|appam|puttu|kerala parotta|malabar parotta|chapati|butter naan|garlic naan|tandoori roti|kulcha|amritsari kulcha|sarson da saag|makki di roti|palak paneer|kadai paneer|shahi paneer|
matar paneer|malai kofta|aloo gobi|bhindi masala|baingan bharta|jeera aloo|dal tadka|dal fry|sambar rice|rasam rice|veg pulao|jeera rice|pasta|white sauce pasta|red sauce pasta|mac and cheese|lasagna|noodles|
ramen|sushi|tacos|burrito|nachos|quesadilla|falafel|hummus|salad|caesar salad|fruit salad|soup|tomato soup|sweet corn soup|hot and sour soup|manchow soup|cake|chocolate cake|cheesecake|brownie|cupcake|
donut|ice cream|kulfi|falooda|gulab jamun|rasgulla|rasmalai|jalebi|kaju katli|ladoo|motichoor ladoo|barfi|peda|halwa|gajar halwa|moong dal halwa|kheer|payasam|shrikhand|mishti doi|sandesh|modak|
puran poli|malpua|cold coffee|filter coffee|masala chai|lassi|mango lassi|buttermilk|milkshake|chocolate shake|smoothie|fresh juice|sugarcane juice|coconut water|lemon soda|mojito|bubble tea|green tea|
idiyappam|pesarattu|akki roti|neer dosa|ghee roast|chicken 65|chettinad chicken|kolhapuri chicken|goan fish curry|vindaloo|xacuti|sorpotel|dhansak|patra ni machhi|bombil fry|pomfret fry|
kosha mangsho|shorshe ilish|chingri malai curry|aloo posto|luchi|ghugni|jhalmuri|puchka|kathi kebab|galouti kebab|tunday kebab|kakori kebab|awadhi biryani|kolkata biryani|ambur biryani|dindigul biryani""".replace("\n", "").split("|")
DISHES = [d.strip() for d in DISHES if d.strip()]

ROLES = """software engineer|software developer|frontend developer|backend developer|full stack developer|data analyst|data scientist|data engineer|machine learning engineer|devops engineer|cloud engineer|
cyber security analyst|network engineer|system administrator|qa tester|automation tester|android developer|ios developer|ui ux designer|graphic designer|video editor|content writer|copywriter|
digital marketing executive|seo specialist|social media manager|marketing manager|sales executive|business development executive|relationship manager|customer support executive|call centre executive|
telecaller|receptionist|office assistant|admin executive|hr executive|hr recruiter|payroll executive|accountant|accounts executive|chartered accountant|tax consultant|auditor|financial analyst|
bank clerk|bank po|loan officer|insurance advisor|insurance agent|teacher|primary teacher|math teacher|science teacher|english teacher|hindi teacher|computer teacher|tuition teacher|lecturer|professor|
librarian|counsellor|nurse|staff nurse|doctor|medical officer|pharmacist|lab technician|radiographer|physiotherapist|dietitian|dentist|medical representative|caretaker|elderly caretaker|nanny|
house help|cook|chef|kitchen helper|waiter|hotel manager|front office executive|housekeeping staff|security guard|driver|delivery boy|delivery partner|warehouse helper|store keeper|packer|
electrician|plumber|carpenter|welder|fitter|mechanic|ac technician|mobile repair technician|civil engineer|site engineer|mechanical engineer|electrical engineer|architect|interior designer|draftsman|
quantity surveyor|project manager|product manager|operations manager|supply chain executive|logistics executive|purchase executive|store manager|retail sales associate|cashier|beautician|hair stylist|
makeup artist|tailor|fashion designer|photographer|event manager|travel agent|tour guide|pilot|cabin crew|ground staff|merchant navy|police constable|data entry operator|typist|stenographer|
translator|lawyer|legal assistant|company secretary|journalist|news anchor|anchor|voice over artist|actor|model|gym trainer|yoga instructor|sports coach|dance teacher|music teacher|
farm manager|agriculture officer|veterinary doctor|lab assistant|research associate|research scientist|clinical research associate|medical coder|medical transcriptionist|telemarketing executive|
field sales executive|area sales manager|branch manager|team leader|intern|work from home|part time|freshers""".replace("\n", "").split("|")
ROLES = [r.strip() for r in ROLES if r.strip()]

SERVICES = """plumber|electrician|carpenter|painter|ac repair|fridge repair|washing machine repair|tv repair|ro water purifier service|pest control|home cleaning|sofa cleaning|bathroom cleaning|
packers and movers|car repair|bike repair|car wash|tyre shop|puncture repair|locksmith|key maker|cctv installation|inverter repair|computer repair|laptop repair|mobile repair|printer repair|
internet service provider|gas agency|tiffin service|caterer|cook for home|maid service|babysitter|elder care service|nursing care at home|physiotherapist at home|diagnostic lab|blood bank|
ambulance service|pharmacy open 24 hours|veterinary clinic|pet grooming|beauty parlour|salon|spa|tailor|dry cleaner|laundry|shoe repair|watch repair|optician|hearing aid centre|dentist|
eye hospital|multispecialty hospital|ayurvedic clinic|homeopathy clinic|yoga classes|gym|swimming pool|dance classes|music classes|tuition classes|coaching centre|driving school|
photo studio|printing shop|xerox shop|courier service|post office|bank|atm|petrol pump|ev charging station|car rental|bike rental|travel agency|hotel|lodge|pg accommodation|hostel|
marriage hall|banquet hall|event planner|florist|cake shop|sweet shop|bakery|grocery store|vegetable market|fish market|meat shop|organic store|stationery shop|book store|toy store|
furniture shop|hardware store|electronics store|mobile store|jewellery shop|temple|church|mosque|gurudwara|park|library|museum|police station|fire station|government hospital|
notary|lawyer|chartered accountant|astrologer|pandit for puja""".replace("\n", "").split("|")
SERVICES = [s.strip() for s in SERVICES if s.strip()]

SPECIALITIES = """cardiologist|dermatologist|orthopedist|dentist|ophthalmologist|ent specialist|gynecologist|pediatrician|neurologist|psychiatrist|psychologist|physiotherapist|diabetologist|
endocrinologist|general physician|gastroenterologist|urologist|nephrologist|pulmonologist|oncologist|rheumatologist|homeopath|ayurveda doctor|sexologist|dietitian|nutritionist|
plastic surgeon|general surgeon|neurosurgeon|cardiac surgeon|spine surgeon|ivf specialist|infertility specialist|trichologist|cosmetologist|allergist|hematologist|geriatrician|
sleep specialist|pain management specialist|vascular surgeon|bariatric surgeon|audiologist|speech therapist|occupational therapist|chiropractor|podiatrist|orthodontist|periodontist|endodontist""".replace("\n", "").split("|")

MOVIES = """Jawan|Pathaan|Animal|Dunki|Tiger 3|Gadar 2|12th Fail|OMG 2|Rocky Aur Rani|Stree 2|Bhool Bhulaiyaa 3|Singham Again|Kalki 2898 AD|Pushpa 2|Devara|Salaar|Leo|Jailer|Vikram|RRR|
KGF Chapter 2|Kantara|Hanu-Man|Fighter|Crew|Laapataa Ladies|Shaitaan|Article 370|Maidaan|Chandu Champion|Kill|Munjya|Vicky Vidya|Khel Khel Mein|Vedaa|Yudhra|Jigra|The Sabarmati Report|
Sky Force|Chhaava|Deva|Sikandar|War 2|Housefull 5|Raid 2|Jaat|Kesari Chapter 2|Bhool Chuk Maaf|Metro In Dino|Saiyaara|Coolie|Thug Life|Retro|Good Bad Ugly|Amaran|Lucky Baskhar|
Manjummel Boys|Aavesham|Premalu|Bramayugam|Marco|L2 Empuraan|Thudarum|Hridayapoorvam|Lokah|Kantara Chapter 1|Mirai|They Call Him OG|Hari Hara Veera Mallu|Kingdom|Game Changer|
Daaku Maharaaj|Sankranthiki Vasthunam|Tandel|Court|Hit 3|Dragon|Viduthalai 2|Vettaiyan|Maharaja|Garudan|Indian 2|Raayan|Oppenheimer|Barbie|Dune Part Two|Deadpool and Wolverine|
Inside Out 2|Moana 2|Wicked|Gladiator II|Mission Impossible|Jurassic World Rebirth|Superman|Avatar Fire and Ash|Zootopia 2|Spider-Man|Godzilla x Kong""".replace("\n", "").split("|")

CUISINES = """north indian|south indian|chinese|italian|continental|mughlai|biryani|street food|fast food|pizza|burgers|desserts|cafe|bakery|seafood|kerala|bengali|gujarati|rajasthani|
punjabi|maharashtrian|andhra|chettinad|hyderabadi|lucknowi|goan|thai|japanese|korean|mexican|lebanese|mediterranean|american|healthy food|salads|pure veg|jain food|vegan|ice cream|tea and snacks""".replace("\n", "").split("|")

LANGS = [("hindi", "hi"), ("marathi", "mr"), ("tamil", "ta"), ("telugu", "te"), ("kannada", "kn"), ("malayalam", "ml"), ("bengali", "bn"), ("gujarati", "gu"), ("punjabi", "pa"), ("urdu", "ur"),
         ("odia", "or"), ("assamese", "as"), ("sanskrit", "sa"), ("nepali", "ne"), ("english", "en"), ("french", "fr"), ("german", "de"), ("spanish", "es"), ("arabic", "ar"), ("japanese", "ja")]
PHRASES = """good morning|good night|how are you|thank you|i love you|i miss you|happy birthday|where is the hospital|i need a doctor|call an ambulance|i am lost|how much does this cost|
what is your name|my name is|nice to meet you|please help me|i don't understand|speak slowly please|where is the toilet|i am hungry|i am thirsty|water please|food please|the bill please|
how far is it|which way|turn left|turn right|go straight|stop here|wait here|come here|go away|be careful|take care|see you soon|good luck|congratulations|welcome|sorry|excuse me|
yes|no|maybe|today|tomorrow|yesterday|now|later|morning|evening|night|family|mother|father|brother|sister|son|daughter|grandmother|grandfather|friend|teacher|doctor|police|market|train station|
bus stop|airport|temple|school|hospital|medicine|fever|headache|stomach ache|cold and cough|blood pressure|sugar|pain|tablet|injection|happy diwali|happy holi|eid mubarak|merry christmas|
happy new year|jai hind|i am fine|what time is it|how old are you|where do you live|i live in india|i am a student|i am retired|i am a farmer|i work in an office|let's go|hurry up|slow down|
it is hot|it is cold|it is raining|the weather is nice|i am tired|i am sleepy|i am happy|i am sad|i am angry|i am scared|don't worry|everything is fine|call me|text me|send money|
open the door|close the window|switch on the light|switch off the fan|bring tea|make food|clean the room|wash clothes|buy vegetables|pay the bill|book a ticket|cancel the order""".replace("\n", "").split("|")

MEDICINES = """paracetamol|dolo 650|crocin|calpol|combiflam|ibuprofen|aspirin|ecosprin|disprin|saridon|metformin|glycomet|janumet|glimepiride|amaryl|insulin|amlodipine|telmisartan|telma|losartan|
atenolol|metoprolol|atorvastatin|rosuvastatin|clopidogrel|pantoprazole|pan 40|omeprazole|rantac|ranitidine|digene|gelusil|eno|cetirizine|levocetirizine|allegra|montelukast|benadryl|ascoril|
grilinctus|azithromycin|amoxicillin|augmentin|ciprofloxacin|ofloxacin|metronidazole|doxycycline|cefixime|thyronorm|eltroxin|levothyroxine|shelcal|calcium|vitamin d3|uprise d3|becosules|
neurobion|limcee|zincovit|supradyn|revital|ors|electral|loperamide|norflox|cyclopam|meftal spas|drotaverine|ondansetron|domperidone|vicks|otrivin|volini|moov|iodex|betadine|soframycin|
burnol|silverex|candid|clotrimazole|fluconazole|terbinafine|mupirocin|dexamethasone|prednisolone|hydrocortisone|alprazolam|clonazepam|sertraline|escitalopram|amitriptyline|gabapentin|pregabalin|
tramadol|diclofenac|aceclofenac|nimesulide|naproxen|folic acid|iron tablets|ferrous sulphate|b12 injection|methylcobalamin|liv 52|himalaya liv52|chyawanprash|ashwagandha|triphala|isabgol""".replace("\n", "").split("|")

CONDITIONS = """diabetes|high blood pressure|low blood pressure|thyroid|hypothyroidism|arthritis|knee pain|back pain|neck pain|migraine|headache|fever|dengue|malaria|typhoid|jaundice|
cold and cough|sore throat|asthma|bronchitis|pneumonia|tuberculosis|acidity|gas|constipation|diarrhoea|piles|kidney stones|uti|anaemia|vitamin d deficiency|vitamin b12 deficiency|
cholesterol|heart attack|stroke|paralysis|parkinsons|alzheimers|dementia|depression|anxiety|insomnia|obesity|pcos|pregnancy|menopause|osteoporosis|gout|psoriasis|eczema|acne|
hair fall|dandruff|cataract|glaucoma|dry eyes|hearing loss|vertigo|sinusitis|tonsils|toothache|mouth ulcers|food poisoning|chickenpox|measles|covid|flu|allergy|skin rash|fatty liver|
gallstones|hernia|varicose veins|sciatica|frozen shoulder|carpal tunnel|plantar fasciitis|cervical spondylosis|slip disc|fibromyalgia|lupus|epilepsy|bell's palsy|shingles""".replace("\n", "").split("|")

GODS = ["ganesh", "shiv", "hanuman", "ram", "krishna", "durga", "lakshmi", "saraswati", "sai baba", "vishnu", "kali", "parvati", "kartikeya", "ayyappa", "balaji", "jagannath", "khatu shyam",
        "shani dev", "surya dev", "gayatri", "radha krishna", "vitthal", "santoshi mata", "vaishno devi", "ganga maa", "narmada maa", "guru nanak", "mahavir", "buddha", "jesus"]
DEVOTIONAL = ["bhajan", "aarti", "chalisa", "mantra", "stotram", "songs", "katha", "live darshan"]

CARS = """maruti swift|maruti baleno|maruti dzire|maruti brezza|maruti ertiga|maruti wagonr|maruti alto|maruti celerio|maruti fronx|maruti grand vitara|hyundai creta|hyundai venue|hyundai i20|
hyundai verna|hyundai exter|hyundai alcazar|tata nexon|tata punch|tata harrier|tata safari|tata tiago|tata altroz|tata curvv|mahindra thar|mahindra scorpio n|mahindra xuv700|mahindra xuv 3xo|
mahindra bolero|kia seltos|kia sonet|kia carens|toyota innova crysta|toyota innova hycross|toyota fortuner|toyota glanza|toyota hyryder|honda city|honda amaze|honda elevate|mg hector|mg astor|
mg windsor|mg comet|skoda kushaq|skoda slavia|volkswagen taigun|volkswagen virtus|renault kiger|renault triber|nissan magnite|citroen c3|jeep compass|bmw 3 series|mercedes c class|audi a4|
honda activa|tvs jupiter|suzuki access|tvs ntorq|hero splendor|hero hf deluxe|bajaj pulsar|bajaj platina|honda shine|royal enfield classic 350|royal enfield bullet|royal enfield hunter 350|
yamaha r15|yamaha fz|ktm duke|tvs apache|bajaj chetak|ather 450x|ola s1 pro|tvs iqube""".replace("\n", "").split("|")

COLLEGES = """iit bombay|iit delhi|iit madras|iit kanpur|iit kharagpur|iit roorkee|iit guwahati|iit hyderabad|nit trichy|nit surathkal|nit warangal|bits pilani|vit vellore|manipal university|
srm university|amity university|delhi university|jnu|bhu|amu|jamia millia islamia|iim ahmedabad|iim bangalore|iim calcutta|iim lucknow|xlri|fms delhi|aiims delhi|cmc vellore|afmc pune|
kmc manipal|nlsiu bangalore|nalsar hyderabad|nlu delhi|st stephens college|lady shri ram college|hindu college|miranda house|christ university|symbiosis pune|fergusson college|coep pune|
vjti mumbai|ict mumbai|iiser pune|iisc bangalore|jadavpur university|presidency university|anna university|osmania university|university of hyderabad|pune university|mumbai university|
calcutta university|madras university|lpu|chandigarh university|thapar university|dtu|nsut|iiit hyderabad|iiit delhi|iiit bangalore|nift delhi|nid ahmedabad|ftii pune|iihm|ihm mumbai""".replace("\n", "").split("|")

CODE_TASKS = """reverse a string|sort a list|read a file|write a file|make an http request|parse json|connect to a database|create a class|handle exceptions|use a for loop|use a while loop|
define a function|work with dates|generate random numbers|split a string|join strings|find the length of a list|remove duplicates from a list|merge two lists|create a dictionary|iterate over a dictionary|
check if a key exists|convert string to integer|convert integer to string|format a string|use regular expressions|read user input|print to the console|create a virtual environment|install a package|
write unit tests|use async await|create a thread|read a csv file|write a csv file|send an email|make a gui|draw a chart|scrape a website|call an api|upload a file|download a file|zip a folder|
resize an image|calculate factorial|check prime number|fibonacci series|binary search|bubble sort|matrix multiplication|find the maximum|count words|reverse a list|copy a file|delete a file|
list files in a folder|get the current time|sleep for seconds|exit a program|comment code|declare a constant|use enums|use interfaces|inherit a class|override a method|use generics|use lambdas""".replace("\n", "").split("|")
LANGUAGES = ["python", "javascript", "java", "c", "c++", "c#", "go", "rust", "php", "ruby", "kotlin", "swift", "typescript", "sql", "bash", "powershell", "r", "dart", "excel vba", "matlab"]

UNITS = [("kg", "pounds"), ("pounds", "kg"), ("km", "miles"), ("miles", "km"), ("celsius", "fahrenheit"), ("fahrenheit", "celsius"), ("feet", "metres"), ("metres", "feet"), ("inches", "cm"),
         ("cm", "inches"), ("litres", "gallons"), ("gallons", "litres"), ("grams", "ounces"), ("ounces", "grams"), ("acres", "square feet"), ("square feet", "square metres"), ("hectares", "acres"),
         ("km per hour", "miles per hour"), ("hours", "minutes"), ("days", "hours"), ("gb", "mb"), ("tb", "gb"), ("usd", "inr"), ("eur", "inr"), ("gbp", "inr"), ("aed", "inr"), ("inr", "usd"),
         ("bigha", "acres"), ("gaj", "square feet"), ("tola", "grams")]

T = {}
T["swiggy1"] = template("order {dish} in {city} on swiggy", ["open https://www.swiggy.com/search?query={dish:url}", "wait for \"{dish}\"", "click \"{dish}\""], "Here's {dish} on Swiggy; pick a restaurant and I'll add it.")
T["swiggy2"] = template("get {dish} delivered in {city} from swiggy", ["open https://www.swiggy.com/search?query={dish:url}", "wait for \"{dish}\"", "click \"{dish}\""], "Here's {dish} on Swiggy.")
T["zomato1"] = template("order {dish} in {city} on zomato", ["open https://www.zomato.com/{city:slug}/delivery/dish-{dish:slug}"], "Here's {dish} delivery in {city} on Zomato.")
T["zomato2"] = template("find {dish} in {city} on zomato", ["open https://www.zomato.com/{city:slug}/delivery/dish-{dish:slug}"], "Here's {dish} in {city} on Zomato.")
T["bestdish"] = template("best {dish} in {city}", ["open https://www.google.com/search?q=best+{dish:url}+in+{city:url}"], "Here are the best places for {dish} in {city}.")
T["dishnear"] = template("where to eat {dish} in {city}", ["open https://www.google.com/maps/search/{dish:url}+in+{city:url}"], "Here are places for {dish} in {city}.")
T["li"] = template("find {role} jobs in {city} on linkedin", ["open https://www.linkedin.com/jobs/search/?keywords={role:url}&location={city:url}"], "Here are {role} jobs in {city} on LinkedIn.")
T["naukri"] = template("find {role} jobs in {city} on naukri", ["open https://www.naukri.com/{role:slug}-jobs-in-{city:slug}"], "Here are {role} jobs in {city} on Naukri.")
T["indeed"] = template("find {role} jobs in {city} on indeed", ["open https://in.indeed.com/jobs?q={role:url}&l={city:url}"], "Here are {role} jobs in {city} on Indeed.")
T["jobsin"] = template("{role} vacancies in {city}", ["open https://www.google.com/search?q={role:url}+vacancies+in+{city:url}"], "Here are {role} vacancies in {city}.")
T["jobsgoogle"] = template("{role} job openings in {city}", ["open https://www.google.com/search?q={role:url}+jobs+in+{city:url}&ibp=htl;jobs"], "Here are {role} openings in {city}.")
T["jobsapply"] = template("apply for {role} jobs in {city}", ["open https://in.indeed.com/jobs?q={role:url}&l={city:url}"], "Here are {role} jobs in {city} you can apply to.")
T["svc1"] = template("find a {service} in {city}", ["open https://www.google.com/maps/search/{service:url}+in+{city:url}"], "Here are {service} options in {city}.")
T["svc2"] = template("need a {service} in {city}", ["open https://www.google.com/maps/search/{service:url}+in+{city:url}"], "Here are {service} options in {city}.")
T["svcjd"] = template("{service} in {city} on justdial", ["open https://www.justdial.com/{city:slug}/{service:slug}"], "Here are {service} listings in {city} on Justdial.")
T["doc1"] = template("find a {speciality} in {city}", ["open https://www.practo.com/{city:slug}/{speciality:slug}"], "Here are {speciality}s in {city} on Practo.")
T["doc2"] = template("book a {speciality} in {city} on practo", ["open https://www.practo.com/{city:slug}/{speciality:slug}"], "Here are {speciality}s in {city}; pick a time and I'll help book.")
T["doc3"] = template("best {speciality} in {city}", ["open https://www.google.com/search?q=best+{speciality:url}+in+{city:url}"], "Here are top {speciality}s in {city}.")
T["mov1"] = template("{movie} tickets in {city}", ["open https://in.bookmyshow.com/explore/movies-{city:slug}", "wait for \"{movie}\"", "click \"{movie}\""], "Here's {movie} in {city}; pick a show.")
T["mov2"] = template("book tickets for {movie} in {city}", ["open https://in.bookmyshow.com/explore/movies-{city:slug}", "wait for \"{movie}\"", "click \"{movie}\""], "Here's {movie} in {city}; pick a show and seats.")
T["mov3"] = template("{movie} showtimes in {city}", ["open https://www.google.com/search?q={movie:url}+showtimes+{city:url}"], "Here are {movie} showtimes in {city}.")
T["rest1"] = template("{cuisine} restaurants in {city}", ["open https://www.zomato.com/{city:slug}/restaurants/{cuisine:slug}"], "Here are {cuisine} restaurants in {city}.")
T["rest2"] = template("best {cuisine} food in {city}", ["open https://www.google.com/maps/search/best+{cuisine:url}+restaurant+in+{city:url}"], "Here are the best {cuisine} places in {city}.")
T["wx1"] = template("will it rain in {city} tomorrow", ["open https://www.google.com/search?q=will+it+rain+in+{city:url}+tomorrow"], "Here's tomorrow's forecast for {city}.")
T["wx2"] = template("{city} weather this week", ["open https://www.google.com/search?q={city:url}+weather+this+week"], "Here's this week's weather in {city}.")
T["wx3"] = template("aqi in {city}", ["open https://www.google.com/search?q=aqi+in+{city:url}"], "Here's the air quality in {city}.")
T["wx4"] = template("temperature in {city} today", ["open https://www.google.com/search?q=temperature+in+{city:url}+today"], "Here's today's temperature in {city}.")
T["wx5"] = template("sunrise time in {city}", ["open https://www.google.com/search?q=sunrise+time+in+{city:url}"], "Here's sunrise in {city}.")
T["wx6"] = template("humidity in {city} today", ["open https://www.google.com/search?q=humidity+in+{city:url}"], "Here's the humidity in {city}.")
T["wx7"] = template("weather forecast for {city}", ["open https://www.google.com/search?q=weather+forecast+{city:url}"], "Here's the forecast for {city}.")
T["wx8"] = template("is it cold in {city}", ["open https://www.google.com/search?q=weather+{city:url}"], "Here's the weather in {city}.")
for n in ["1", "2", "3", "4"]:
    T[f"rent{n}"] = template(f"{n} bhk flat for rent in {{city}}", [f"open https://www.magicbricks.com/property-for-rent/residential-real-estate?bedroom={n}&cityName={{city:url}}"], f"Here are {n} BHK flats for rent in {{city}}.")
    T[f"buy{n}"] = template(f"buy a {n} bhk flat in {{city}}", [f"open https://www.magicbricks.com/property-for-sale/residential-real-estate?bedroom={n}&cityName={{city:url}}"], f"Here are {n} BHK flats for sale in {{city}}.")
T["pg"] = template("pg for rent in {city}", ["open https://www.google.com/search?q=pg+for+rent+in+{city:url}"], "Here are PGs in {city}.")
T["hotelnear"] = template("budget hotels in {city}", ["open https://www.google.com/travel/hotels/{city:url}"], "Here are hotels in {city}.")
T["visit"] = template("best time to visit {city}", ["open https://www.google.com/search?q=best+time+to+visit+{city:url}"], "Here's the best time to visit {city}.")
T["famous"] = template("what is {city} famous for", ["open https://www.google.com/search?q=what+is+{city:url}+famous+for"], "Here's what {city} is famous for.")
T["localnews"] = template("{city} local news", ["open https://news.google.com/search?q={city:url}&hl=en-IN&gl=IN&ceid=IN:en"], "Here's local news for {city}.")
T["trainab"] = template("cheapest way from {a} to {b}", ["open https://www.google.com/search?q=cheapest+way+from+{a:url}+to+{b:url}"], "Here's how to get from {a} to {b} cheaply.")
T["busab"] = template("bus tickets from {a} to {b}", ["open https://www.redbus.in/search?fromCityName={a:url}&toCityName={b:url}"], "Here are buses from {a} to {b}.")
T["flab"] = template("flight tickets from {a} to {b}", ["open https://www.google.com/travel/flights?q=flights+from+{a:url}+to+{b:url}"], "Here are flights from {a} to {b}.")
T["cabab"] = template("drive from {a} to {b}", ["open https://www.google.com/maps/dir/?api=1&origin={a:url}&destination={b:url}&travelmode=driving"], "Here's the drive from {a} to {b}.")
T["trainlist"] = template("train tickets from {a} to {b}", ["open https://www.google.com/search?q=trains+from+{a:url}+to+{b:url}"], "Here are trains from {a} to {b}.")
T["distab"] = template("how many km from {a} to {b}", ["open https://www.google.com/maps/dir/?api=1&origin={a:url}&destination={b:url}"], "Here's the distance from {a} to {b}.")
for app, url in [("blinkit", "https://blinkit.com/s/?q={item:url}"), ("zepto", "https://www.zeptonow.com/search?query={item:url}"), ("instamart", "https://www.swiggy.com/instamart/search?query={item:url}"), ("bigbasket", "https://www.bigbasket.com/ps/?q={item:url}")]:
    T[app + "1"] = template(f"order {{item}} on {app}", ["open " + url, "wait for \"{item}\"", "click \"Add\""], f"Added {{item}} on {app.title()}; check the cart before paying.")
    T[app + "2"] = template(f"get {{item}} from {app}", ["open " + url], f"Here's {{item}} on {app.title()}.")
for name, code in LANGS:
    T["say" + code] = template(f"how do you say {{phrase}} in {name}", [f"open https://translate.google.com/?sl=auto&tl={code}&text={{phrase:url}}&op=translate"], f"Here's \"{{phrase}}\" in {name.title()}.")
    T["tr" + code] = template(f"translate {{phrase}} into {name}", [f"open https://translate.google.com/?sl=auto&tl={code}&text={{phrase:url}}&op=translate"], f"Here's \"{{phrase}}\" in {name.title()}.")
T["gita"] = template("bhagavad gita chapter {c} verse {v}", ["open https://www.holy-bhagavad-gita.org/chapter/{c}/verse/{v}"], "Here's Gita chapter {c}, verse {v}.")
T["gitach"] = template("read bhagavad gita chapter {c}", ["open https://www.holy-bhagavad-gita.org/chapter/{c}"], "Here's chapter {c} of the Gita.")
T["dev"] = template("play {god} {kind}", ["open https://www.youtube.com/results?search_query={god:url}+{kind:url}", "click \"{god}\"", "sound on", "skip ads"], "Playing {god} {kind}.")
T["dev2"] = template("put on {god} {kind}", ["open https://www.youtube.com/results?search_query={god:url}+{kind:url}", "click \"{god}\"", "sound on", "skip ads"], "Playing {god} {kind}.")
T["med1"] = template("uses of {med}", ["open https://www.1mg.com/search/all?name={med:url}"], "Here's {med} on 1mg; ask your doctor before taking it.")
T["med2"] = template("price of {med}", ["open https://www.1mg.com/search/all?name={med:url}"], "Here's the price of {med}.")
T["med3"] = template("alternatives to {med}", ["open https://www.google.com/search?q=alternatives+to+{med:url}+tablet"], "Here are alternatives to {med}; check with your doctor.")
T["med4"] = template("can i take {med} with food", ["open https://www.google.com/search?q={med:url}+before+or+after+food"], "Here's when to take {med}; your doctor's advice comes first.")
T["med5"] = template("order {med} online", ["open https://www.1mg.com/search/all?name={med:url}"], "Here's {med} on 1mg.")
T["cond1"] = template("diet for {condition}", ["open https://www.google.com/search?q=diet+for+{condition:url}"], "Here's diet advice for {condition}.")
T["cond2"] = template("exercises for {condition}", ["open https://www.youtube.com/results?search_query=exercises+for+{condition:url}", "click \"{condition}\"", "sound on", "skip ads"], "Here are exercises for {condition}.")
T["cond3"] = template("home remedies for {condition}", ["open https://www.google.com/search?q=home+remedies+for+{condition:url}"], "Here are home remedies for {condition}; see a doctor if it's serious.")
T["cond4"] = template("treatment for {condition}", ["open https://www.google.com/search?q=treatment+for+{condition:url}"], "Here's how {condition} is treated; please consult a doctor.")
T["cond5"] = template("which doctor for {condition}", ["open https://www.google.com/search?q=which+doctor+to+see+for+{condition:url}"], "Here's which doctor treats {condition}.")
T["cond6"] = template("test for {condition}", ["open https://www.google.com/search?q=test+for+{condition:url}"], "Here are tests for {condition}.")
T["car1"] = template("on road price of {car} in {city}", ["open https://www.google.com/search?q=on+road+price+of+{car:url}+in+{city:url}"], "Here's the on-road price of the {car} in {city}.")
T["car2"] = template("{car} review", ["open https://www.youtube.com/results?search_query={car:url}+review", "click \"{car}\"", "sound on", "skip ads"], "Here's a {car} review.")
T["car3"] = template("{car} mileage", ["open https://www.google.com/search?q={car:url}+mileage"], "Here's the {car} mileage.")
T["car4"] = template("{car} on cardekho", ["open https://www.google.com/search?q=site%3Acardekho.com+{car:url}"], "Here's the {car} on CarDekho.")
T["car5"] = template("{car} service centre in {city}", ["open https://www.google.com/maps/search/{car:url}+service+centre+in+{city:url}"], "Here are {car} service centres in {city}.")
T["col1"] = template("{college} admission", ["open https://www.google.com/search?q={college:url}+admission"], "Here's admission info for {college}.")
T["col2"] = template("{college} fees", ["open https://www.google.com/search?q={college:url}+fees"], "Here are {college} fees.")
T["col3"] = template("{college} cutoff", ["open https://www.google.com/search?q={college:url}+cutoff"], "Here's the {college} cutoff.")
T["col4"] = template("{college} placements", ["open https://www.google.com/search?q={college:url}+placements"], "Here are {college} placements.")
T["col5"] = template("{college} website", ["open https://www.google.com/search?q={college:url}+official+website"], "Here's the {college} website.")
T["code1"] = template("how to {task} in {lang}", ["open https://www.google.com/search?q=how+to+{task:url}+in+{lang:url}"], "Here's how to {task} in {lang}.")
T["code2"] = template("{lang} code to {task}", ["open https://www.google.com/search?q={lang:url}+code+to+{task:url}"], "Here's {lang} code to {task}.")
T["code3"] = template("{lang} tutorial for beginners", ["open https://www.youtube.com/results?search_query={lang:url}+tutorial+for+beginners", "click \"{lang}\"", "sound on", "skip ads"], "Here's a {lang} tutorial.")
T["solve"] = template("solve {eq}", ["open https://www.wolframalpha.com/input?i={eq:url}"], "Here's the solution to {eq}.")
T["calc"] = template("calculate {eq} on wolfram", ["open https://www.wolframalpha.com/input?i={eq:url}"], "Here's {eq} worked out.")
T["unit"] = template("convert {n} {a} to {b}", ["open https://www.google.com/search?q={n:url}+{a:url}+to+{b:url}"], "Here's {n} {a} in {b}.")
T["unit2"] = template("how many {b} is {n} {a}", ["open https://www.google.com/search?q={n:url}+{a:url}+to+{b:url}"], "Here's {n} {a} in {b}.")
T["kid1"] = template("play {rhyme} for kids", ["open https://www.youtube.com/results?search_query={rhyme:url}+for+kids", "click \"{rhyme}\"", "sound on", "skip ads"], "Playing {rhyme}.")
T["kid2"] = template("tell a story about {rhyme}", ["open https://www.youtube.com/results?search_query={rhyme:url}+story+for+kids", "click \"{rhyme}\"", "sound on", "skip ads"], "Here's a story about {rhyme}.")
T["share1"] = template("post {text} on twitter", ["open https://x.com/intent/post?text={text:url}", "wait for \"Post\""], "Your post is ready; press Post when you're happy with it.")
T["share2"] = template("share {text} on whatsapp", ["open https://wa.me/?text={text:url}", "wait for \"Continue to Chat\"", "click \"Continue to Chat\""], "Choose who to send it to on WhatsApp.")
T["share3"] = template("share {text} on telegram", ["open https://t.me/share/url?url={text:url}"], "Choose who to share it with on Telegram.")
T["ping"] = template("ping {host}", ["run Test-Connection {host} -Count 4 | Select-Object Address,ResponseTime | Out-String"], "")
T["down"] = template("is {host} down", ["run if (Test-Connection {host} -Count 2 -Quiet) {{ '{host} is up' }} else {{ '{host} is not answering' }}"], "")
T["ipof"] = template("what is the ip of {host}", ["run (Resolve-DnsName {host} -Type A | Select-Object -First 1).IPAddress"], "")
T["book1"] = template("buy the book {book} on amazon", ["open https://www.amazon.in/s?k={book:url}&i=stripbooks", "click \"{book}\"", "wait for \"Add to Cart\"", "click \"Add to Cart\"", "expect \"Added to Cart\""], "Added {book} to your Amazon cart.")
T["book2"] = template("summary of the book {book}", ["research {book} book summary"], "")
T["book3"] = template("{book} audiobook", ["open https://www.youtube.com/results?search_query={book:url}+audiobook", "click \"{book}\"", "sound on", "skip ads"], "Playing the {book} audiobook.")

for city in CITIES:
    for d in DISHES:
        for k in ["swiggy1", "swiggy2", "zomato1", "zomato2", "bestdish", "dishnear"]:
            use(T[k], {"dish": d, "city": city})
for city in CITIES:
    for r in ROLES:
        for k in ["li", "naukri", "indeed", "jobsin", "jobsgoogle", "jobsapply"]:
            use(T[k], {"role": r, "city": city})
for city in CITIES:
    for s in SERVICES:
        for k in ["svc1", "svcjd"]:
            use(T[k], {"service": s, "city": city})
    for sp in SPECIALITIES:
        for k in ["doc1", "doc3"]:
            use(T[k], {"speciality": sp, "city": city})
    for m in MOVIES:
        use(T["mov2"], {"movie": m, "city": city})
    for c in CUISINES:
        use(T["rest1"], {"cuisine": c, "city": city})
        use(T["rest2"], {"cuisine": c, "city": city})
    for k in ["wx1", "wx2", "wx3", "wx4", "wx5", "wx6", "wx7", "wx8", "rent1", "rent2", "rent3", "rent4", "buy1", "buy2", "buy3", "pg", "hotelnear", "visit", "famous", "localnews"]:
        use(T[k], {"city": city})
for i, a in enumerate(CITIES):
    for b in CITIES[i + 1:i + 26]:
        for k in ["trainab", "busab", "flab", "cabab", "trainlist", "distab"]:
            use(T[k], {"a": a, "b": b})
GROCERY = """milk|curd|paneer|butter|ghee|cheese|eggs|bread|atta|maida|besan|rice|basmati rice|poha|suji|oats|cornflakes|muesli|sugar|jaggery|salt|turmeric|chilli powder|coriander powder|garam masala|
jeera|mustard seeds|hing|toor dal|moong dal|chana dal|masoor dal|urad dal|rajma|kabuli chana|sunflower oil|mustard oil|groundnut oil|olive oil|coconut oil|tea|coffee|green tea|biscuits|namkeen|
chips|chocolates|ice cream|juice|soft drinks|water bottle|onions|potatoes|tomatoes|ginger|garlic|green chillies|coriander|mint|lemons|cucumber|carrots|cabbage|cauliflower|spinach|methi|bhindi|
brinjal|capsicum|beans|peas|bottle gourd|bitter gourd|pumpkin|sweet potato|bananas|apples|oranges|grapes|mangoes|papaya|pomegranate|watermelon|guava|pineapple|kiwi|dates|almonds|cashews|raisins|
walnuts|peanuts|honey|jam|ketchup|mayonnaise|noodles|pasta|vermicelli|soap|shampoo|toothpaste|toothbrush|detergent|dishwash bar|floor cleaner|toilet cleaner|tissue paper|garbage bags|
diapers|baby food|sanitary pads|razor|shaving cream|hair oil|face wash|body lotion|sunscreen|deodorant|batteries|bulb|mosquito repellent|agarbatti|camphor|matchbox|candles""".replace("\n", "").split("|")
for g in GROCERY:
    for app in ["blinkit", "zepto", "instamart", "bigbasket"]:
        use(T[app + "1"], {"item": g})
        use(T[app + "2"], {"item": g})
for name, code in LANGS:
    for p in PHRASES:
        use(T["say" + code], {"phrase": p})
        use(T["tr" + code], {"phrase": p})
VERSES = [47, 72, 43, 42, 29, 47, 30, 28, 34, 42, 55, 20, 35, 27, 20, 24, 28, 78]
for c, n in enumerate(VERSES, 1):
    use(T["gitach"], {"c": str(c)})
    for v in range(1, n + 1):
        use(T["gita"], {"c": str(c), "v": str(v)})
for g in GODS:
    for d in DEVOTIONAL:
        use(T["dev"], {"god": g, "kind": d})
        use(T["dev2"], {"god": g, "kind": d})
for m in MEDICINES:
    for k in ["med1", "med2", "med3", "med4", "med5"]:
        use(T[k], {"med": m})
for c in CONDITIONS:
    for k in ["cond1", "cond2", "cond3", "cond4", "cond5", "cond6"]:
        use(T[k], {"condition": c})
for car in CARS:
    for k in ["car2", "car3", "car4"]:
        use(T[k], {"car": car})
    for city in CITIES[:60]:
        use(T["car1"], {"car": car, "city": city})
        use(T["car5"], {"car": car, "city": city})
for col in COLLEGES:
    for k in ["col1", "col2", "col3", "col4", "col5"]:
        use(T[k], {"college": col})
for lang in LANGUAGES:
    use(T["code3"], {"lang": lang})
    for t in CODE_TASKS:
        use(T["code1"], {"task": t, "lang": lang})
        use(T["code2"], {"task": t, "lang": lang})
for _ in range(6000):
    kind = random.randint(0, 4)
    a, b, c = random.randint(1, 20), random.randint(1, 50), random.randint(1, 99)
    if kind == 0:
        eq = f"{a}x + {b} = {c}"
    elif kind == 1:
        eq = f"x^2 + {a}x - {b} = 0"
    elif kind == 2:
        eq = f"{a}x - {b} = {c}x + {a}"
    elif kind == 3:
        eq = f"derivative of x^{a} + {b}x"
    else:
        eq = f"integral of {a}x^2 + {b}"
    use(T["solve"], {"eq": eq})
    use(T["calc"], {"eq": eq})
for n in [1, 2, 3, 5, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75, 100, 150, 200, 250, 500, 1000]:
    for a, b in UNITS:
        use(T["unit"], {"n": str(n), "a": a, "b": b})
        use(T["unit2"], {"n": str(n), "a": a, "b": b})
RHYMES = """twinkle twinkle little star|johny johny yes papa|baa baa black sheep|humpty dumpty|wheels on the bus|old macdonald|jack and jill|london bridge|rain rain go away|
mary had a little lamb|if you're happy and you know it|head shoulders knees and toes|five little monkeys|row row row your boat|the itsy bitsy spider|hickory dickory dock|
lakdi ki kathi|machli jal ki rani hai|chanda mama door ke|nani teri morni|ek mota haathi|aloo kachaloo|chuha billi|panchatantra|akbar birbal|tenali raman|vikram betal|
hanuman|krishna leela|bal ganesh|chhota bheem|motu patlu|peppa pig|cocomelon|bluey|paw patrol|tom and jerry|doraemon|shinchan|mickey mouse|the lion king|the thirsty crow|
the hare and the tortoise|the lion and the mouse|the fox and the grapes|the boy who cried wolf|the golden goose|the ugly duckling|cinderella|snow white|jungle book|alphabet song|
numbers song|colours song|days of the week|months of the year|fruits song|animals song|vegetables song|body parts song|good habits|good manners|bedtime story|lullaby""".replace("\n", "").split("|")
for r in RHYMES:
    use(T["kid1"], {"rhyme": r})
    use(T["kid2"], {"rhyme": r})
for p in PHRASES:
    use(T["share1"], {"text": p})
    use(T["share2"], {"text": p})
    use(T["share3"], {"text": p})
HOSTS = ["google.com", "youtube.com", "amazon.in", "flipkart.com", "facebook.com", "instagram.com", "whatsapp.com", "github.com", "microsoft.com", "apple.com", "netflix.com", "irctc.co.in",
         "sbi.co.in", "hdfcbank.com", "icicibank.com", "gmail.com", "outlook.com", "zoom.us", "wikipedia.org", "cloudflare.com", "1.1.1.1", "8.8.8.8", "bing.com", "yahoo.com", "linkedin.com",
         "twitter.com", "x.com", "reddit.com", "zomato.com", "swiggy.com", "paytm.com", "phonepe.com", "jio.com", "airtel.in", "bsnl.co.in", "nic.in", "gov.in", "uidai.gov.in", "incometax.gov.in", "claude.ai"]
for h in HOSTS:
    for k in ["ping", "down", "ipof"]:
        use(T[k], {"host": h})
BOOKS = """the alchemist|atomic habits|rich dad poor dad|the psychology of money|ikigai|think and grow rich|wings of fire|the monk who sold his ferrari|you can win|the secret|
sapiens|the power of your subconscious mind|deep work|the 7 habits of highly effective people|how to win friends and influence people|man's search for meaning|the gita|ramayana|
mahabharata|godan|gaban|madhushala|gitanjali|malgudi days|the guide|train to pakistan|the god of small things|the white tiger|a suitable boy|midnight's children|the palace of illusions|
the immortals of meluha|shiva trilogy|chanakya's chant|two states|five point someone|the india story|discovery of india|my experiments with truth|ignited minds|india after gandhi|
harry potter|the lord of the rings|the hobbit|the hunger games|percy jackson|diary of a wimpy kid|wonder|matilda|charlie and the chocolate factory|the little prince|the kite runner|
a thousand splendid suns|to kill a mockingbird|1984|animal farm|pride and prejudice|the great gatsby|the da vinci code|gone girl|the silent patient|it ends with us|verity|the midnight library""".replace("\n", "").split("|")
for b in BOOKS:
    for k in ["book1", "book2", "book3"]:
        use(T[k], {"book": b})
EXTRA_SVC = ["electricity bill", "water bill", "gas bill", "mobile recharge", "dth recharge", "fastag recharge", "broadband bill", "credit card bill", "insurance premium", "property tax",
             "loan emi", "school fees", "society maintenance", "lpg cylinder booking", "metro card recharge"]
T["pay"] = template("pay {bill} online", ["open https://www.google.com/search?q=pay+{bill:url}+online"], "Here's where to pay the {bill}; I won't pay without you.")
T["pay2"] = template("pay my {bill} with {app}", ["open https://www.google.com/search?q=pay+{bill:url}+on+{app:url}"], "Here's how to pay the {bill} with {app}.")
for bl in EXTRA_SVC:
    use(T["pay"], {"bill": bl})
    for app in ["paytm", "phonepe", "google pay", "amazon pay", "cred", "bhim"]:
        use(T["pay2"], {"bill": bl, "app": app})
GOV = ["download aadhaar", "update aadhaar address", "check aadhaar status", "link aadhaar with pan", "apply for pan card", "check pan status", "apply for passport", "check passport status",
       "epfo passbook", "withdraw pf", "check pf balance", "vehicle rc status", "check traffic challan", "pay traffic challan", "apply for driving licence", "driving licence status",
       "voter id download", "apply for voter id", "check voter list", "ration card status", "apply for ration card", "income certificate", "caste certificate", "birth certificate",
       "death certificate", "property registration", "file income tax return", "check income tax refund", "gst registration", "udyam registration", "pm kisan status", "ayushman card",
       "abha health id", "digilocker documents", "e shram card", "pension status", "senior citizen card", "covid certificate", "fssai licence", "shop act licence"]
T["gov1"] = template("{service} online", ["open https://www.google.com/search?q={service:url}+official+site"], "Here's the official site for {service}.")
T["gov2"] = template("how to {service}", ["open https://www.youtube.com/results?search_query=how+to+{service:url}", "click \"{service}\"", "sound on", "skip ads"], "Here's a video on how to {service}.")
T["gov3"] = template("documents needed to {service}", ["open https://www.google.com/search?q=documents+required+to+{service:url}"], "Here are the documents needed to {service}.")
for gv in GOV:
    for k in ["gov1", "gov2", "gov3"]:
        use(T[k], {"service": gv})
BANKS = ["sbi", "hdfc bank", "icici bank", "axis bank", "kotak mahindra bank", "punjab national bank", "bank of baroda", "canara bank", "union bank of india", "indian bank", "bank of india",
         "central bank of india", "indian overseas bank", "uco bank", "idbi bank", "yes bank", "indusind bank", "idfc first bank", "federal bank", "south indian bank", "karnataka bank",
         "rbl bank", "bandhan bank", "au small finance bank", "post office savings bank", "airtel payments bank", "paytm payments bank", "jio payments bank", "city union bank", "dcb bank"]
T["bank1"] = template("open {bank} net banking", ["open https://www.google.com/search?q={bank:url}+net+banking+login+official"], "Here's {bank} net banking; you log in yourself.")
T["bank2"] = template("{bank} customer care number", ["open https://www.google.com/search?q={bank:url}+customer+care+number"], "Here's the {bank} customer care number.")
T["bank3"] = template("{bank} fd interest rates", ["open https://www.google.com/search?q={bank:url}+fd+interest+rates"], "Here are {bank} FD rates.")
T["bank4"] = template("{bank} branch near me", ["open https://www.google.com/maps/search/{bank:url}+branch+near+me"], "Here are {bank} branches near you.")
T["bank5"] = template("{bank} ifsc code in {city}", ["open https://www.google.com/search?q={bank:url}+ifsc+code+{city:url}"], "Here's the {bank} IFSC in {city}.")
for bk in BANKS:
    for k in ["bank1", "bank2", "bank3", "bank4"]:
        use(T[k], {"bank": bk})
    for city in CITIES[:120]:
        use(T["bank5"], {"bank": bk, "city": city})

LESSONS = [
    "Food apps like Swiggy and Zomato use the delivery location set in the app; if results look wrong, ask the user to set their address.",
    "Job portals need the user's own login to apply; open the listing and let them apply.",
    "Practo and hospital sites show available slots; ask the user which time suits them before booking.",
    "BookMyShow asks for the city first; pick the user's city, then the movie, then a show time.",
    "Quick-commerce apps (Blinkit, Zepto, Instamart) need a delivery address; never place the order without the user.",
    "Government services should only be done on official .gov.in sites; warn the user about look-alike sites.",
    "Never type Aadhaar, PAN or bank numbers unless the user gives them for this task.",
    "Bill payments: open the right page and let the user confirm the amount and pay.",
    "For translations, open Google Translate with the language code; read the result back to the user.",
    "For Bhagavad Gita verses, holy-bhagavad-gita.org has a page for every chapter and verse.",
    "Devotional requests: play from YouTube with sound on and skip ads; prefer well-known channels.",
    "Medicine questions are for information only; always say to follow the doctor's advice.",
    "For coding questions, open a search or documentation page; don't paste code into the user's files without asking.",
    "Maths problems: WolframAlpha shows step-by-step solutions.",
    "Unit and currency conversions: Google shows the answer at the top of the results.",
    "Kids' content: YouTube Kids-friendly searches; keep the volume moderate.",
    "Sharing posts: open the share page and let the user press Post or Send themselves.",
    "Network checks (ping, is a site down) use run with Test-Connection and report the result.",
    "Property sites show many ads; read the listing details (price, area, location) before recommending.",
    "Car prices vary by city and variant; say which city and variant the price is for.",
]
for l in LESSONS:
    lines.append({"lesson": l})


if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else "sahay-800k"
    per = int(sys.argv[2]) if len(sys.argv) > 2 else 100000
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "templates.jsonl"), "w", encoding="utf-8") as f:
        for t in templates:
            f.write(json.dumps(t, ensure_ascii=False) + "\n")
    parts = [lines[i:i + per] for i in range(0, len(lines), per)]
    for n, chunk in enumerate(parts, 1):
        with open(os.path.join(folder, f"sahay-800k-part{n:02d}.jsonl"), "w", encoding="utf-8") as f:
            for item in chunk:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")
    tasks = sum(1 for i in lines if "task" in i)
    print(f"{len(lines)} lines in {len(parts)} parts: {tasks} tasks, {len(lines) - tasks} lessons, {len(templates)} templates")
