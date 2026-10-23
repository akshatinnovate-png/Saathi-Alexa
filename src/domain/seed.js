export const SEED_VERSION = 3;

export function seedData() {
  return {
    meta: [{ id: 'schema', version: SEED_VERSION }],
    profile: [
      {
        id: 'elder',
        name: 'Kamala Deshpande',
        preferredName: 'Aaji',
        language: 'mr',
        secondaryLanguage: 'hi',
        city: 'Pune',
        home: 'Flat 4A, Shanti Apartments, Kothrud, Pune',
        i18n: {
          hi: { preferredName: 'आजी', home: 'फ़्लैट 4A, शांति अपार्टमेंट्स, कोथरूड, पुणे' },
          mr: { preferredName: 'आजी', home: 'फ्लॅट 4A, शांती अपार्टमेंट्स, कोथरूड, पुणे' },
        },
        accessibility: {
          memorySupport: true,
          hearing: 'mild-loss',
          vision: 'reading-glasses',
          preferredPace: 'slow',
          largeText: true,
        },
        privacy: { shareMoodWords: true },
        devices: [{ id: 'front-door', kind: 'ring-video-doorbell', location: 'front door' }],
        routine: [
          { time: '07:00', activity: 'Morning tea and prayers', i18n: { hi: { activity: 'सुबह की चाय और पूजा' }, mr: { activity: 'सकाळचा चहा आणि पूजा' } } },
          { time: '09:00', activity: 'Blood pressure tablet (Amlodipine) with breakfast', i18n: { hi: { activity: 'नाश्ते के साथ ब्लड प्रेशर की गोली' }, mr: { activity: 'नाश्त्यासोबत रक्तदाबाची गोळी' } } },
          { time: '13:30', activity: 'Lunch and calcium tablet', i18n: { hi: { activity: 'दोपहर का खाना और कैल्शियम की गोली' }, mr: { activity: 'दुपारचं जेवण आणि कॅल्शियमची गोळी' } } },
          { time: '17:00', activity: 'Evening walk in the society garden with Meera', i18n: { hi: { activity: 'मीरा के साथ सोसाइटी के बगीचे में शाम की सैर' }, mr: { activity: 'मीरासोबत सोसायटीच्या बागेत संध्याकाळचं फिरणं' } } },
          { time: '19:30', activity: 'Video call with Riya', days: [0, 3], i18n: { hi: { activity: 'रिया के साथ वीडियो कॉल' }, mr: { activity: 'रियासोबत व्हिडिओ कॉल' } } },
          { time: '21:00', activity: 'Memory tablet (Donepezil) before bed', i18n: { hi: { activity: 'सोने से पहले याददाश्त की गोली' }, mr: { activity: 'झोपण्यापूर्वी स्मरणशक्तीची गोळी' } } },
        ],
      },
    ],
    circle: [
      {
        id: 'riya', name: 'Riya', relationship: 'granddaughter', role: 'family', aliases: ['रिया', 'पोती', 'नात'],
        language: 'en', city: 'Toronto', timezone: 'America/Toronto',
        aboutForElder: "Riya is Anand's daughter. She studies architecture in Toronto and loves your puran poli.",
        i18n: {
          hi: { name: 'रिया', relationship: 'पोती', aboutForElder: 'रिया आनंद की बेटी है। वह टोरंटो में आर्किटेक्चर पढ़ती है और उसे आपकी पूरनपोली बहुत पसंद है।' },
          mr: { name: 'रिया', relationship: 'नात', aboutForElder: 'रिया ही आनंदची मुलगी. ती टोरंटोमध्ये आर्किटेक्चर शिकते आणि तिला तुमची पुरणपोळी खूप आवडते.' },
        },
        escalationOrder: 1,
      },
      {
        id: 'anand', name: 'Anand', relationship: 'son', role: 'family', aliases: ['आनंद', 'बेटा', 'मुलगा'],
        language: 'hi', city: 'Bengaluru', timezone: 'Asia/Kolkata',
        aboutForElder: 'Anand is your son. He works in Bengaluru and visits on the second Saturday of each month.',
        i18n: {
          hi: { name: 'आनंद', relationship: 'बेटा', aboutForElder: 'आनंद आपका बेटा है। वह बेंगलुरु में काम करता है और हर महीने के दूसरे शनिवार को मिलने आता है।' },
          mr: { name: 'आनंद', relationship: 'मुलगा', aboutForElder: 'आनंद तुमचा मुलगा. तो बंगळुरूमध्ये काम करतो आणि दर महिन्याच्या दुसऱ्या शनिवारी भेटायला येतो.' },
        },
        escalationOrder: 1,
      },
      {
        id: 'meera', name: 'Meera', relationship: 'neighbour', role: 'neighbour', aliases: ['मीरा', 'पड़ोसी', 'शेजारी', 'neighbor'],
        language: 'mr', city: 'Pune', timezone: 'Asia/Kolkata',
        aboutForElder: 'Meera lives next door in flat 4B. She walks with you every evening at five.',
        i18n: {
          hi: { name: 'मीरा', relationship: 'पड़ोसन', aboutForElder: 'मीरा बगल वाले फ़्लैट 4B में रहती हैं। वह रोज़ शाम पाँच बजे आपके साथ टहलती हैं।' },
          mr: { name: 'मीरा', relationship: 'शेजारीण', aboutForElder: 'मीरा शेजारच्या 4B फ्लॅटमध्ये राहतात. त्या रोज संध्याकाळी पाच वाजता तुमच्यासोबत फिरायला येतात.' },
        },
        escalationOrder: 2,
      },
    ],
    medications: [
      {
        id: 'amlodipine', name: 'Amlodipine 5 mg', purpose: 'blood pressure', time: '09:00', withFood: true, description: 'small white round tablet',
        phrase: 'small white round tablet for blood pressure', short: 'blood pressure tablet',
        i18n: {
          hi: { phrase: 'ब्लड प्रेशर की छोटी सफ़ेद गोल गोली', short: 'ब्लड प्रेशर की गोली' },
          mr: { phrase: 'रक्तदाबाची छोटी पांढरी गोल गोळी', short: 'रक्तदाबाची गोळी' },
        },
      },
      {
        id: 'calcium', name: 'Calcium + Vitamin D', purpose: 'bones', time: '13:30', withFood: true, description: 'large white oval tablet',
        phrase: 'large white oval tablet for your bones', short: 'calcium tablet',
        i18n: {
          hi: { phrase: 'हड्डियों की बड़ी सफ़ेद अंडाकार गोली', short: 'कैल्शियम की गोली' },
          mr: { phrase: 'हाडांची मोठी पांढरी लंबगोल गोळी', short: 'कॅल्शियमची गोळी' },
        },
      },
      {
        id: 'donepezil', name: 'Donepezil 5 mg', purpose: 'memory', time: '21:00', withFood: false, description: 'small yellow tablet',
        phrase: 'small yellow tablet for memory', short: 'memory tablet',
        i18n: {
          hi: { phrase: 'याददाश्त की छोटी पीली गोली', short: 'याददाश्त की गोली' },
          mr: { phrase: 'स्मरणशक्तीची छोटी पिवळी गोळी', short: 'स्मरणशक्तीची गोळी' },
        },
      },
    ],
    doses: [],
    checkins: [],
    stories: [],
    messages: [
      {
        id: 'msg-seed-1', from: 'riya', to: 'elder', language: 'en', createdAt: new Date(Date.now() - 3 * 3600e3).toISOString(),
        text: 'Good morning Aaji! I passed my design review today. I wish I could eat your puran poli to celebrate. Call you on Wednesday!',
        translations: {
          mr: 'सुप्रभात आजी! आज माझं डिझाइन रिव्ह्यू पास झालं. हे साजरं करायला तुमची पुरणपोळी खायला मिळाली असती तर किती छान झालं असतं. बुधवारी फोन करते!',
          hi: 'सुप्रभात आजी! आज मेरा डिज़ाइन रिव्यू पास हो गया। काश जश्न मनाने के लिए आपकी पूरनपोली खा पाती। बुधवार को फ़ोन करूँगी!',
        },
        read: false,
      },
    ],
    alerts: [],
    door: [],
  };
}
