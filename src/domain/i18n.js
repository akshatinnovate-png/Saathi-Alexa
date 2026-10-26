export const SPOKEN_LANGUAGES = ['en', 'hi', 'mr'];

const PART_OF_DAY = {
  en: { morning: 'morning', afternoon: 'afternoon', evening: 'evening', night: 'night' },
  hi: { morning: 'सुबह', afternoon: 'दोपहर', evening: 'शाम', night: 'रात' },
  mr: { morning: 'सकाळ', afternoon: 'दुपार', evening: 'संध्याकाळ', night: 'रात्र' },
};

const AND = { en: ' and ', hi: ' और ', mr: ' आणि ' };

const MESSAGES = {
  en: {
    whereIs: ({ item, room, note }) => `Your ${item}: in the ${room}${note ? `, ${note}` : ''}.`,
    whereUnknown: () => "I'm not sure where that is kept. I'll ask your family to add it to the house map.",
    voiceNote: ({ from }) => `${from} sent you a voice message. Here it is.`,
    refillArranged: ({ name, short }) => `${name} has arranged more of your ${short}. You don't need to worry about it.`,
    apptWhen: ({ kind, date, lower }) => (kind === 'today' ? (lower ? 'today' : 'Today') : kind === 'tomorrow' ? (lower ? 'tomorrow' : 'Tomorrow') : `${lower ? 'on' : 'On'} ${date}`),
    apptLine: ({ when, time, with: who, place, escort }) => `${when} at ${time} you see ${who} at ${place}.${escort ? ` ${escort} will take you.` : ''}`,
    apptNone: () => 'There are no doctor visits in the next two weeks.',
    escortComing: ({ name, title, when }) => `${name} will take you to your ${title.toLowerCase()} ${when}.`,
    orient: ({ date, time, part, home }) => `Today is ${date}. It is ${time} in the ${part}. You are at home, in ${home}.`,
    orientNext: ({ activity, time }) => ` Next is ${activity.toLowerCase()} at ${time}.`,
    orientRest: () => ' There is nothing else planned today. You can rest.',
    whoNotFound: ({ query }) => `I don't have anyone called ${query} in your family circle yet. That's alright.`,
    medsDue: ({ list, withFood }) => `It's time for your ${list}.${withFood ? ' Please take it with some food.' : ''}`,
    medsDueJoin: () => ', and your ',
    medsCaughtUp: ({ upcoming }) => `You're all caught up.${upcoming.map((m) => ` Your ${m.short} is at ${m.time}.`).join('')}`,
    medNotFound: () => "I couldn't tell which tablet you mean, and nothing is due right now. That's okay.",
    medAlreadyTaken: ({ short, time }) => `You already took your ${short} today at ${time}. No need to take another one.`,
    medRecorded: ({ short }) => `Thank you. I've noted your ${short}. Well done.`,
    checkUrgent: () => "I'm here with you. I'm letting your family know right now, and I'll stay with you. If you can, please sit down somewhere safe.",
    checkPrivate: () => "Thank you for trusting me with that. I'll keep it between us. I'm here if you want to talk more.",
    checkLonely: () => "Thank you for telling me. You are not alone. I've let your family know you're thinking of them, and I'm sure someone will call soon. Would you like to hear Riya's last message, or tell me a story from when you were young?",
    checkGentle: () => "Thank you for telling me how you feel. I've let your family know, gently. Would you like some water, or to rest for a little while?",
    checkFine: () => "That's lovely to hear. I've saved it so your family can smile about it too.",
    helpStarted: () => "Okay. I'm calling your family now. Stay where you are, I'm right here with you. If nobody answers quickly, I will ask Meera from next door to come.",
    helpAlready: () => "I've already called your family and they are on their way. I'm staying right here with you.",
    messageLine: ({ from, relationship, text }) => `${from}, your ${relationship}, says: ${text}`,
    noMessages: () => 'There are no new messages. Everyone is well.',
    recipientNotFound: ({ to }) => `I couldn't find ${to} in your family circle.`,
    sent: ({ names, translated }) => `I've sent it to ${names}${translated ? ', in their own language' : ''}.`,
    confirmSend: ({ to, message }) => `Shall I send this to ${to ?? 'your family'}? "${message}"`,
    notSent: () => "Alright, I haven't sent it. You can tell me again whenever you like.",
    storySaved: ({ title }) => `What a beautiful memory. I've saved "${title}" in your memory book, and shared it with your family in their languages.`,
    storyCount: ({ count, title }) => `Your memory book has ${count} stories. The latest is "${title}".`,
    storyNone: () => 'Your memory book is waiting for its first story.',
    doorDuringAlert: () => 'Someone is at your front door. It may be Meera coming to help you. Take your time.',
    helperComing: ({ name }) => `${name} has seen your message and is coming to help.`,
    idle: () => "I'm here. You can ask me what day it is, about your tablets, for messages from your family, or tell me a story.",
  },
  hi: {
    whereIs: ({ item, room, note }) => `${item}: ${room} में${note ? `, ${note}` : ''}।`,
    whereUnknown: () => 'मुझे पक्का नहीं पता वह कहाँ रखा है। मैं परिवार से उसे घर के नक्शे में जोड़ने को कहूँगी।',
    voiceNote: ({ from }) => `${from} ने आपको आवाज़ में संदेश भेजा है। सुनिए।`,
    refillArranged: ({ name, short }) => `${name} ने आपकी ${short} और मँगवा दी है। आपको चिंता करने की ज़रूरत नहीं।`,
    apptWhen: ({ kind, date }) => (kind === 'today' ? 'आज' : kind === 'tomorrow' ? 'कल' : `${date} को`),
    apptLine: ({ when, time, with: who, place, escort }) => `${when} ${time} बजे आपको ${place} में ${who} से मिलना है।${escort ? ` ${escort} आपको ले जाएँगे।` : ''}`,
    apptNone: () => 'अगले दो हफ़्तों में डॉक्टर के पास जाना नहीं है।',
    escortComing: ({ name, title, when }) => `${name} ${when} आपको ${title} के लिए ले जाएँगे।`,
    orient: ({ date, time, part, home }) => `आज ${date} है। ${part} के ${time} बजे हैं। आप अपने घर पर हैं, ${home} में।`,
    orientNext: ({ activity, time }) => ` अगला काम है ${activity}, ${time} बजे।`,
    orientRest: () => ' आज और कुछ तय नहीं है। आप आराम कर सकती हैं।',
    whoNotFound: ({ query }) => `आपके परिवार में ${query} नाम का कोई अभी नहीं है। कोई बात नहीं।`,
    medsDue: ({ list, withFood }) => `आपकी ${list} लेने का समय हो गया है।${withFood ? ' कृपया इसे कुछ खाने के साथ लें।' : ''}`,
    medsDueJoin: () => ' और ',
    medsCaughtUp: ({ upcoming }) => `सब ठीक है, अभी कोई दवा बाकी नहीं है।${upcoming.map((m) => ` ${m.short} ${m.time} बजे है।`).join('')}`,
    medNotFound: () => 'मुझे समझ नहीं आया कि कौन सी गोली, और अभी कोई गोली बाकी नहीं है। कोई बात नहीं।',
    medAlreadyTaken: ({ short, time }) => `आप आज ${time} बजे ${short} ले चुकी हैं। दूसरी लेने की ज़रूरत नहीं है।`,
    medRecorded: ({ short }) => `धन्यवाद। मैंने ${short} लिख ली है। बहुत अच्छे।`,
    checkUrgent: () => 'मैं आपके साथ हूँ। मैं अभी आपके परिवार को बता रही हूँ, और मैं यहीं रहूँगी। हो सके तो किसी सुरक्षित जगह बैठ जाइए।',
    checkPrivate: () => 'मुझ पर भरोसा करने के लिए धन्यवाद। यह बात हमारे बीच ही रहेगी। आप और बात करना चाहें तो मैं यहीं हूँ।',
    checkLonely: () => 'बताने के लिए धन्यवाद। आप अकेली नहीं हैं। मैंने आपके परिवार को बता दिया है कि आप उन्हें याद कर रही हैं, कोई जल्दी ही फ़ोन करेगा। क्या आप रिया का पिछला संदेश सुनना चाहेंगी, या बचपन की कोई कहानी सुनाएँगी?',
    checkGentle: () => 'अपना हाल बताने के लिए धन्यवाद। मैंने धीरे से आपके परिवार को बता दिया है। क्या थोड़ा पानी पिएँगी, या कुछ देर आराम करेंगी?',
    checkFine: () => 'यह सुनकर बहुत अच्छा लगा। मैंने इसे सहेज लिया है ताकि आपका परिवार भी मुस्कुरा सके।',
    helpStarted: () => 'ठीक है। मैं अभी आपके परिवार को बुला रही हूँ। आप जहाँ हैं वहीं रहिए, मैं आपके साथ हूँ। अगर कोई जल्दी जवाब नहीं देता, तो मैं पड़ोस की मीरा को बुलाऊँगी।',
    helpAlready: () => 'मैंने आपके परिवार को पहले ही बुला लिया है, वे आ रहे हैं। मैं यहीं आपके साथ हूँ।',
    messageLine: ({ from, relationship, text }) => `${from} (${relationship}) का संदेश: ${text}`,
    noMessages: () => 'कोई नया संदेश नहीं है। सब ठीक हैं।',
    recipientNotFound: ({ to }) => `${to} आपके परिवार में नहीं मिले।`,
    sent: ({ names, translated }) => `मैंने यह ${names} को भेज दिया है${translated ? ', उनकी अपनी भाषा में' : ''}।`,
    confirmSend: ({ to, message }) => `क्या मैं यह ${to ?? 'आपके परिवार'} को भेज दूँ? "${message}"`,
    notSent: () => 'ठीक है, मैंने नहीं भेजा। जब चाहें फिर से बता दीजिए।',
    storySaved: ({ title }) => `कितनी सुंदर याद है। मैंने "${title}" आपकी यादों की किताब में सहेज ली है, और आपके परिवार को उनकी भाषाओं में भेज दी है।`,
    storyCount: ({ count, title }) => `आपकी यादों की किताब में ${count} कहानियाँ हैं। सबसे नई है "${title}"।`,
    storyNone: () => 'आपकी यादों की किताब पहली कहानी का इंतज़ार कर रही है।',
    doorDuringAlert: () => 'आपके दरवाज़े पर कोई है। शायद मीरा आपकी मदद के लिए आई हैं। आराम से जाइए।',
    helperComing: ({ name }) => `${name} ने आपका संदेश देख लिया है और मदद के लिए आ रहे हैं।`,
    idle: () => 'मैं यहीं हूँ। आप पूछ सकती हैं कि आज कौन सा दिन है, अपनी दवा के बारे में, परिवार के संदेश, या कोई कहानी सुना सकती हैं।',
  },
  mr: {
    whereIs: ({ item, room, note }) => `${item}: ${room}मध्ये${note ? `, ${note}` : ''}.`,
    whereUnknown: () => 'ते कुठे ठेवलं आहे ते मला नक्की माहीत नाही. मी घरच्यांना घराच्या नकाशात ते जोडायला सांगते.',
    voiceNote: ({ from }) => `${from} यांनी तुम्हाला आवाजात निरोप पाठवला आहे. ऐका.`,
    refillArranged: ({ name, short }) => `${name} यांनी तुमची ${short} आणखी मागवली आहे. काळजी करू नका.`,
    apptWhen: ({ kind, date }) => (kind === 'today' ? 'आज' : kind === 'tomorrow' ? 'उद्या' : `${date} रोजी`),
    apptLine: ({ when, time, with: who, place, escort }) => `${when} ${time} वाजता तुम्हाला ${place} इथे ${who} यांना भेटायचं आहे.${escort ? ` ${escort} तुम्हाला घेऊन जातील.` : ''}`,
    apptNone: () => 'पुढच्या दोन आठवड्यांत डॉक्टरकडे जायचं नाही.',
    escortComing: ({ name, title, when }) => `${name} ${when} तुम्हाला ${title}साठी घेऊन जातील.`,
    orient: ({ date, time, part, home }) => `आज ${date} आहे. ${part}चे ${time} वाजले आहेत. तुम्ही तुमच्या घरी आहात, ${home} इथे.`,
    orientNext: ({ activity, time }) => ` पुढे ${time} वाजता ${activity}.`,
    orientRest: () => ' आज आणखी काही ठरलेलं नाही. तुम्ही आराम करू शकता.',
    whoNotFound: ({ query }) => `तुमच्या कुटुंबात ${query} नावाचं कोणी अजून नाही. काही हरकत नाही.`,
    medsDue: ({ list, withFood }) => `तुमची ${list} घ्यायची वेळ झाली आहे.${withFood ? ' कृपया थोडं खाऊन घ्या.' : ''}`,
    medsDueJoin: () => ' आणि ',
    medsCaughtUp: ({ upcoming }) => `सगळं वेळेवर झालं आहे.${upcoming.map((m) => ` ${m.short} ${m.time} वाजता आहे.`).join('')}`,
    medNotFound: () => 'कोणती गोळी ते मला समजलं नाही, आणि आत्ता कोणतीही गोळी बाकी नाही. काही हरकत नाही.',
    medAlreadyTaken: ({ short, time }) => `तुम्ही आज ${time} वाजता ${short} घेतली आहे. दुसरी घ्यायची गरज नाही.`,
    medRecorded: ({ short }) => `धन्यवाद. मी ${short} नोंदवली आहे. छान!`,
    checkUrgent: () => 'मी तुमच्यासोबत आहे. मी आत्ताच तुमच्या घरच्यांना कळवत आहे, आणि मी इथेच आहे. जमलं तर एखाद्या सुरक्षित जागी बसा.',
    checkPrivate: () => 'माझ्यावर विश्वास ठेवल्याबद्दल धन्यवाद. ही गोष्ट आपल्यातच राहील. अजून बोलायचं असेल तर मी इथे आहे.',
    checkLonely: () => 'सांगितल्याबद्दल धन्यवाद. तुम्ही एकट्या नाही आहात. तुम्हाला त्यांची आठवण येते आहे हे मी घरच्यांना कळवलं आहे, कोणीतरी लवकरच फोन करेल. रियाचा शेवटचा निरोप ऐकायचा आहे का, की लहानपणीची एखादी गोष्ट सांगाल?',
    checkGentle: () => 'तुम्हाला कसं वाटतंय ते सांगितल्याबद्दल धन्यवाद. मी हळूच घरच्यांना कळवलं आहे. थोडं पाणी प्यायचं का, की थोडा वेळ आराम करायचा?',
    checkFine: () => 'हे ऐकून खूप छान वाटलं. मी हे जपून ठेवलं आहे, म्हणजे घरच्यांनाही आनंद होईल.',
    helpStarted: () => 'ठीक आहे. मी आत्ताच तुमच्या घरच्यांना बोलावत आहे. तुम्ही आहात तिथेच थांबा, मी तुमच्यासोबत आहे. कोणी लवकर उत्तर दिलं नाही, तर मी शेजारच्या मीराला बोलावीन.',
    helpAlready: () => 'मी घरच्यांना आधीच बोलावलं आहे, ते येत आहेत. मी इथेच तुमच्यासोबत आहे.',
    messageLine: ({ from, relationship, text }) => `${from} (${relationship}) यांचा निरोप: ${text}`,
    noMessages: () => 'नवीन निरोप नाही. सगळे ठीक आहेत.',
    recipientNotFound: ({ to }) => `${to} तुमच्या कुटुंबात सापडले नाहीत.`,
    sent: ({ names, translated }) => `मी हे ${names} यांना पाठवलं आहे${translated ? ', त्यांच्या भाषेत' : ''}.`,
    confirmSend: ({ to, message }) => `हे ${to ? `${to} यांना` : 'घरच्यांना'} पाठवू का? "${message}"`,
    notSent: () => 'ठीक आहे, मी पाठवलं नाही. हवं तेव्हा पुन्हा सांगा.',
    storySaved: ({ title }) => `किती सुंदर आठवण! मी "${title}" तुमच्या आठवणींच्या वहीत जपून ठेवली आहे, आणि घरच्यांना त्यांच्या भाषेत पाठवली आहे.`,
    storyCount: ({ count, title }) => `तुमच्या आठवणींच्या वहीत ${count} गोष्टी आहेत. सगळ्यात नवी आहे "${title}".`,
    storyNone: () => 'तुमची आठवणींची वही पहिल्या गोष्टीची वाट पाहते आहे.',
    doorDuringAlert: () => 'तुमच्या दारात कोणीतरी आलं आहे. कदाचित मीरा मदतीला आली असेल. सावकाश जा.',
    helperComing: ({ name }) => `${name} यांनी तुमचा निरोप पाहिला आहे आणि ते मदतीला येत आहेत.`,
    idle: () => 'मी इथेच आहे. आज कोणता दिवस आहे, तुमच्या गोळ्या, घरच्यांचे निरोप याबद्दल विचारू शकता, किंवा एखादी गोष्ट सांगू शकता.',
  },
};

export function spokenLanguage(language) {
  return SPOKEN_LANGUAGES.includes(language) ? language : 'en';
}

export function t(language, key, params = {}) {
  const lang = spokenLanguage(language);
  return (MESSAGES[lang][key] ?? MESSAGES.en[key])(params);
}

export function partOfDayName(language, part) {
  return PART_OF_DAY[spokenLanguage(language)][part];
}

export function joinNames(language, names) {
  return names.join(AND[spokenLanguage(language)]);
}

const DIGITS = { mr: '०१२३४५६७८९' };

export function localDigits(language, text) {
  const set = DIGITS[language];
  return set ? String(text).replace(/[0-9]/g, (d) => set[d]) : String(text);
}

export function localized(item, field, language) {
  return item?.i18n?.[language]?.[field] ?? item?.[field];
}
