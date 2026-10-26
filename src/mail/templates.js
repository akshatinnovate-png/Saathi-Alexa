const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout({ preheader, heading, paragraphs, button, footer, lang = 'en' }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;font:16px/1.55 Inter,Segoe UI,Noto Sans Devanagari,Arial,sans-serif;color:#2b2f3a">${esc(p)}</p>`).join('');
  const cta = button
    ? `<p style="margin:26px 0 10px"><a href="${esc(button.href)}" style="display:inline-block;background:#16181d;color:#ffffff;text-decoration:none;font:600 16px Inter,Segoe UI,Arial,sans-serif;padding:14px 26px;border-radius:999px">${esc(button.label)}</a></p>
       <p style="margin:0 0 4px;font:13px/1.5 Inter,Segoe UI,Arial,sans-serif;color:#6b7280">${esc(button.fallback)}<br><a href="${esc(button.href)}" style="color:#1f5fbf;word-break:break-all">${esc(button.href)}</a></p>`
    : '';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(heading)}</title></head>
<body style="margin:0;background:#f3ebdd;padding:24px 12px">
<span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:24px">
<tr><td style="padding:28px 32px 0;font:400 26px Georgia,'Times New Roman',serif;color:#16181d">Saathi <span style="font-size:18px;color:#8a7b66">साथी</span></td></tr>
<tr><td style="padding:18px 32px 30px">
<h1 style="margin:0 0 16px;font:400 26px/1.25 Georgia,'Times New Roman',serif;color:#16181d">${esc(heading)}</h1>
${body}${cta}
</td></tr>
<tr><td style="padding:18px 32px 26px;border-top:1px solid #eee6d8;font:12px/1.5 Inter,Segoe UI,Arial,sans-serif;color:#7a7f8c">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

const INVITE = {
  en: ({ inviter, elder, link }) => ({
    subject: `${inviter} invited you to ${elder}'s circle on Saathi`,
    heading: `Join ${elder}'s circle`,
    paragraphs: [
      `${inviter} uses Saathi to stay close to ${elder}. Saathi is a companion on Alexa that talks with ${elder} in their own language, reminds them about tablets, and lets the family know how they are.`,
      `Join to see how ${elder} is each day, send messages and voice notes they will hear in their language, and get a call for help if they ever need one.`,
    ],
    button: { label: 'Join the circle', href: link, fallback: 'Or open this link:' },
    footer: `You got this email because ${inviter} added you to ${elder}'s family circle. If you weren't expecting it, you can ignore it.`,
  }),
  hi: ({ inviter, elder, link }) => ({
    subject: `${inviter} ने आपको Saathi पर ${elder} के परिवार में जोड़ा है`,
    heading: `${elder} के परिवार से जुड़िए`,
    paragraphs: [
      `${inviter} Saathi से ${elder} के करीब रहते हैं। Saathi, Alexa पर एक साथी है जो ${elder} से उनकी भाषा में बात करता है, दवा याद दिलाता है और परिवार को उनका हाल बताता है।`,
      `जुड़कर आप रोज़ उनका हाल देख सकते हैं, उन्हें संदेश और अपनी आवाज़ भेज सकते हैं, और ज़रूरत पड़ने पर मदद की पुकार पा सकते हैं।`,
    ],
    button: { label: 'परिवार से जुड़ें', href: link, fallback: 'या यह लिंक खोलें:' },
    footer: `यह ईमेल इसलिए आया क्योंकि ${inviter} ने आपको ${elder} के परिवार में जोड़ा है।`,
  }),
  mr: ({ inviter, elder, link }) => ({
    subject: `${inviter} यांनी तुम्हाला Saathi वर ${elder} यांच्या कुटुंबात बोलावले आहे`,
    heading: `${elder} यांच्या कुटुंबात सामील व्हा`,
    paragraphs: [
      `${inviter} Saathi वापरून ${elder} यांच्या जवळ राहतात. Saathi हा Alexa वरचा साथी आहे जो ${elder} यांच्याशी त्यांच्या भाषेत बोलतो, गोळ्यांची आठवण करून देतो आणि कुटुंबाला त्यांची खबर देतो.`,
      `सामील होऊन तुम्ही रोज त्यांची खबर पाहू शकता, त्यांना निरोप आणि तुमचा आवाज पाठवू शकता, आणि गरज पडल्यास मदतीची हाक मिळवू शकता.`,
    ],
    button: { label: 'कुटुंबात सामील व्हा', href: link, fallback: 'किंवा ही लिंक उघडा:' },
    footer: `${inviter} यांनी तुम्हाला ${elder} यांच्या कुटुंबात जोडले म्हणून हा ईमेल आला.`,
  }),
};

const toText = ({ heading, paragraphs, button, footer }) => [heading, '', ...paragraphs, '', button ? `${button.label}: ${button.href}` : '', '', footer].join('\n');

export function inviteEmail({ inviter, elder, link, language = 'en' }) {
  const lang = INVITE[language] ? language : 'en';
  const copy = INVITE[lang]({ inviter, elder, link });
  return { subject: copy.subject, html: layout({ ...copy, preheader: copy.paragraphs[0], lang }), text: toText(copy) };
}

export function alertEmail({ subject, message, link, severity = 'info' }) {
  const urgent = severity === 'critical' || severity === 'high';
  const copy = {
    heading: subject,
    paragraphs: [message],
    button: link ? { label: urgent ? "Open Saathi and tap “I'm on it”" : 'Open Saathi', href: link, fallback: 'Or open this link:' } : null,
    footer: 'You get these emails because you are in this family circle on Saathi.',
  };
  return { subject: urgent ? `Urgent: ${subject}` : subject, html: layout({ ...copy, preheader: message }), text: toText(copy) };
}

export function testEmail({ name, link }) {
  const copy = {
    heading: 'Saathi can send email',
    paragraphs: [`Hi ${name}, this is a test from Saathi. Invites and alerts for your family will arrive just like this.`],
    button: link ? { label: 'Open Saathi', href: link, fallback: 'Or open this link:' } : null,
    footer: 'You asked Saathi to send this test.',
  };
  return { subject: 'Saathi email test', html: layout({ ...copy, preheader: copy.paragraphs[0] }), text: toText(copy) };
}
