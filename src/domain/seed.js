export function seedData() {
  return {
    profile: [
      {
        id: 'elder',
        name: 'Kamala Deshpande',
        preferredName: 'Aaji',
        language: 'mr',
        secondaryLanguage: 'hi',
        city: 'Pune',
        home: 'Flat 4A, Shanti Apartments, Kothrud, Pune',
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
          { time: '07:00', activity: 'Morning tea and prayers' },
          { time: '09:00', activity: 'Blood pressure tablet (Amlodipine) with breakfast' },
          { time: '13:30', activity: 'Lunch and calcium tablet' },
          { time: '17:00', activity: 'Evening walk in the society garden with Meera' },
          { time: '19:30', activity: 'Video call with Riya', days: [0, 3] },
          { time: '21:00', activity: 'Memory tablet (Donepezil) before bed' },
        ],
      },
    ],
    circle: [
      {
        id: 'riya', name: 'Riya', relationship: 'granddaughter', role: 'family', aliases: ['रिया', 'पोती', 'नात'],
        language: 'en', city: 'Toronto', timezone: 'America/Toronto',
        aboutForElder: "Riya is Anand's daughter. She studies architecture in Toronto and loves your puran poli.",
        escalationOrder: 1,
      },
      {
        id: 'anand', name: 'Anand', relationship: 'son', role: 'family', aliases: ['आनंद', 'बेटा', 'मुलगा'],
        language: 'hi', city: 'Bengaluru', timezone: 'Asia/Kolkata',
        aboutForElder: 'Anand is your son. He works in Bengaluru and visits on the second Saturday of each month.',
        escalationOrder: 1,
      },
      {
        id: 'meera', name: 'Meera', relationship: 'neighbour', role: 'neighbour', aliases: ['मीरा', 'पड़ोसी', 'शेजारी', 'neighbor'],
        language: 'mr', city: 'Pune', timezone: 'Asia/Kolkata',
        aboutForElder: 'Meera lives next door in flat 4B. She walks with you every evening at five.',
        escalationOrder: 2,
      },
    ],
    medications: [
      { id: 'amlodipine', name: 'Amlodipine 5 mg', purpose: 'blood pressure', time: '09:00', withFood: true, description: 'small white round tablet' },
      { id: 'calcium', name: 'Calcium + Vitamin D', purpose: 'bones', time: '13:30', withFood: true, description: 'large white oval tablet' },
      { id: 'donepezil', name: 'Donepezil 5 mg', purpose: 'memory', time: '21:00', withFood: false, description: 'small yellow tablet' },
    ],
    doses: [],
    checkins: [],
    stories: [],
    messages: [
      {
        id: 'msg-seed-1', from: 'riya', to: 'elder', language: 'en', createdAt: new Date(Date.now() - 3 * 3600e3).toISOString(),
        text: 'Good morning Aaji! I passed my design review today. I wish I could eat your puran poli to celebrate. Call you on Wednesday!',
        read: false,
      },
    ],
    alerts: [],
    door: [],
  };
}
