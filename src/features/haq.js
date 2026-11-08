import { bad, imageInput, needsModel } from './media.js';

const MAHARASHTRA = /maharashtra|महाराष्ट्र/i;

export function benefitsFor(haq = {}, now = new Date(), country = 'IN') {
  if (country && country !== 'IN') return [];
  const year = now.getFullYear();
  const age = haq.birthYear ? year - haq.birthYear : null;
  const items = [];
  if (haq.pensioner) {
    const opens = new Date(Date.UTC(year, age !== null && age >= 80 ? 9 : 10, 1));
    const closes = new Date(Date.UTC(year, 10, 30, 23, 59));
    const done = haq.lifeCertificateYear === year;
    const status = done ? 'done' : now < opens ? 'upcoming' : now <= closes ? 'due' : 'late';
    items.push({
      id: 'life-certificate',
      title: 'Life certificate (Jeevan Pramaan) for the pension',
      status,
      when: { opens: opens.toISOString().slice(0, 10), closes: closes.toISOString().slice(0, 10) },
      why: 'Pensioners must prove every year that they are alive, or the pension can stop. It is usually due in November' + (age !== null && age >= 80 ? '; people aged 80 and over can submit from 1 October.' : '.'),
      steps: [
        'At home: the Jeevan Pramaan face authentication app on an Android phone, with Aadhaar.',
        'Or at the bank or post office branch where the pension comes.',
        'Or ask for doorstep service from the bank or India Post Payments Bank.',
      ],
      link: 'https://jeevanpramaan.gov.in',
      didiCanHelp: true,
    });
  }
  if (age !== null && age >= 70) {
    items.push({
      id: 'ayushman-vay-vandana',
      title: 'Ayushman Vay Vandana card (free hospital cover for everyone 70 and over)',
      status: haq.ayushmanCard ? 'done' : 'eligible',
      why: 'Every Indian aged 70 or more can get hospital treatment cover under Ayushman Bharat PM-JAY, whatever their income.',
      steps: ['Apply with Aadhaar on the Ayushman app or the beneficiary website, or at an empanelled hospital or Common Service Centre.'],
      link: 'https://beneficiary.nha.gov.in',
      didiCanHelp: true,
    });
  }
  if (age !== null && age >= 60 && haq.bplCard) {
    items.push({
      id: 'old-age-pension',
      title: 'Old age pension (National Social Assistance Programme)',
      status: 'check',
      why: 'Elders in below-poverty-line households may get a monthly pension from the central and state government.',
      steps: ['Ask at the local municipal ward office or gram panchayat, with Aadhaar, the BPL card, an age proof and bank details.'],
      link: 'https://nsap.nic.in',
      didiCanHelp: true,
    });
  }
  if (age !== null && age >= 65 && MAHARASHTRA.test(haq.state ?? '')) {
    items.push({
      id: 'shravanbal',
      title: 'Shravanbal Seva Rajya Nivruttivetan Yojana (Maharashtra)',
      status: 'check',
      why: 'A Maharashtra state pension for elders aged 65 and over in low-income families.',
      steps: ['Ask at the tehsil or Sanjay Gandhi Niradhar Yojana office, or apply through Aaple Sarkar.'],
      link: 'https://aaplesarkar.mahaonline.gov.in',
      didiCanHelp: true,
    });
  }
  if (!haq.birthYear) {
    items.push({ id: 'tell-us', title: 'Tell Saathi her year of birth', status: 'check', why: 'Some benefits depend on age.', steps: ['Fill in the form above.'], link: null, didiCanHelp: false });
  }
  return items;
}

const EXPLAIN = `You help an Indian elder understand an official letter, form, bill, notice or message in a photo.
Return only JSON: {"title": string, "plain": string (2 to 4 short sentences in simple English), "whatToDo": [string], "deadline": string, "money": string,
"scamRisk": "none"|"possible"|"likely", "scamSigns": [string]}.
Watch for scam signs: threats of arrest or disconnection, requests for OTP, PIN, card or bank details, urgent payments to personal UPI IDs, links to unknown sites, lottery or prize offers, "digital arrest".
Never invent amounts or dates that are not in the photo; use "" if absent.`;

export function createHaq({ llm, services, translator = null, clock = () => new Date() }) {
  const saathiFor = (h) => services.forHousehold(h);

  async function toElder(householdId, english) {
    const me = await saathiFor(householdId).elder();
    const lang = me?.language ?? 'en';
    if (lang === 'en' || !translator) return { lang: 'en', text: english };
    try { return { lang, text: (await translator.translate(english, { from: 'en', to: lang })).text }; } catch { return { lang: 'en', text: english }; }
  }

  return {
    async view(householdId) {
      const me = await saathiFor(householdId).elder();
      return { settings: me?.haq ?? null, benefits: benefitsFor(me?.haq ?? {}, clock(), me?.country ?? 'IN') };
    },

    async explain(householdId, { image, contentType } = {}) {
      needsModel(llm, 'Explaining a letter');
      const out = await llm.understand({ system: EXPLAIN, prompt: 'What does this say, and what should she do?', media: [imageInput(image, contentType)], maxTokens: 1500 });
      if (!out?.plain) throw bad('Saathi could not read that photo. Try again in good light.', 422);
      const result = {
        title: String(out.title ?? '').slice(0, 120), plain: String(out.plain).slice(0, 800),
        whatToDo: (Array.isArray(out.whatToDo) ? out.whatToDo : []).slice(0, 6).map((x) => String(x).slice(0, 200)),
        deadline: String(out.deadline ?? '').slice(0, 60), money: String(out.money ?? '').slice(0, 60),
        scamRisk: ['none', 'possible', 'likely'].includes(out.scamRisk) ? out.scamRisk : 'none',
        scamSigns: (Array.isArray(out.scamSigns) ? out.scamSigns : []).slice(0, 6).map((x) => String(x).slice(0, 160)),
      };
      const english = [result.plain, ...result.whatToDo].join(' ');
      const elder = await toElder(householdId, result.scamRisk === 'likely' ? `Careful: this looks like a scam. ${result.plain} Do not pay or share any code. Talk to your family first.` : english);
      if (result.scamRisk === 'likely') {
        await saathiFor(householdId).recordScamIncident({ kind: 'other', title: result.title || 'A suspicious letter or message', why: result.scamSigns, explain: result.plain, actions: ['Saathi warned her not to pay or share any code.'] }).catch(() => {});
      }
      return { ...result, forElder: elder };
    },

    async sweep(householdId) {
      const saathi = saathiFor(householdId);
      const me = await saathi.elder();
      if (!me?.haq?.pensioner) return null;
      const life = benefitsFor(me.haq, clock(), me.country ?? 'IN').find((b) => b.id === 'life-certificate');
      if (!life || !['due', 'late'].includes(life.status)) return null;
      const records = await saathi.featureStore('haqReminders');
      const key = `life-${clock().getFullYear()}`;
      const last = await records.get(key);
      if (last && clock().getTime() - Date.parse(last.at) < 7 * 24 * 3600 * 1000) return null;
      await records.put({ id: key, at: clock().toISOString() });
      await saathi.notifyFamilyAbout({
        subject: `${me.preferredName}'s pension life certificate is ${life.status === 'late' ? 'overdue' : 'due this month'}`,
        english: `${me.preferredName} needs to submit the yearly life certificate (Jeevan Pramaan) by ${life.when.closes} so the pension does not stop. It can be done at home with the Jeevan Pramaan app, at the bank, or a Saathi Didi can help. Mark it done in Saathi > Haq when it is submitted.`,
        elderEnglish: `Your pension life certificate is due this month. Your family or a Saathi Didi can help you do it.`,
      });
      return life.status;
    },
  };
}
