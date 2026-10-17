// The words the Telegram bot says, in the reader's own language.
//
// Only the messages that survive the diet (see TG_KINDS in telegram.js) are
// here, and only their fixed words: titles, names and notes are the people's
// own and pass through tgEsc where they are joined in. The language is the
// one the person last chose in the dashboard (users.lang); nobody chose, or a
// language not listed here, reads English.
//
// Uzbek writes oʻ and gʻ with U+02BB, as the brand book asks everywhere.
const W = {
  en: {
    open: 'Open the task ↗',
    pravka: (t) => `📝 Pravka requested on: ${t}`,
    ready: (t) => `✅ Work ready for review: ${t}`,
    late: (t) => `🚨 LATE: ${t}`,
    footage: (t) => `🎞 Footage delivered: ${t}`,
    watch: 'Watch it',
    by: (name) => `by ${name}`,
    delivery: (n, of) => `Delivery ${n} of ${of}`,
    oneLeft: 'one pravka left',
    limit: (n, of) => `🔒 Delivery ${n}${n <= of ? ` of ${of}` : ''} — the pravka limit is reached, so it is approved as it stands.`,
    lastPravka: 'This is the last pravka — the next delivery is approved as it stands.',
    override: (name) => `Pushed past the pravka limit by ${name} (admin override).`,
    lateLine: (what, n) => `${what} is ${n} days late.`,
    what: { shoot: 'The shoot', edit: 'The edit', design: 'The artwork', release: 'The release' },
    footageNext: 'It is yours to edit.',
    footageHeld: 'It is waiting for you: add what editing needs (the TZ, who edits) and send it on.',
  },
  ru: {
    open: 'Открыть задачу ↗',
    pravka: (t) => `📝 Новая правка: ${t}`,
    ready: (t) => `✅ Работа готова к проверке: ${t}`,
    late: (t) => `🚨 ПРОСРОЧЕНО: ${t}`,
    footage: (t) => `🎞 Исходники сданы: ${t}`,
    watch: 'Смотреть',
    by: (name) => `сдал(а) ${name}`,
    delivery: (n, of) => `Сдача ${n} из ${of}`,
    oneLeft: 'осталась одна правка',
    limit: (n, of) => `🔒 Сдача ${n}${n <= of ? ` из ${of}` : ''} — лимит правок исчерпан, работа утверждена как есть.`,
    lastPravka: 'Это последняя правка — следующая сдача будет утверждена как есть.',
    override: (name) => `${name} добавил(а) правку сверх лимита (исключение админа).`,
    lateLine: (what, n) => `${what}: опоздание ${n} дн.`,
    what: { shoot: 'Съёмка', edit: 'Монтаж', design: 'Дизайн', release: 'Релиз' },
    footageNext: 'Можно монтировать.',
    footageHeld: 'Ждёт вас: добавьте, что нужно для монтажа (ТЗ, кто монтирует), и отправьте дальше.',
  },
  uz: {
    open: 'Vazifani ochish ↗',
    pravka: (t) => `📝 Tahrir soʻraldi: ${t}`,
    ready: (t) => `✅ Ish tekshirish uchun tayyor: ${t}`,
    late: (t) => `🚨 KECHIKDI: ${t}`,
    footage: (t) => `🎞 Material topshirildi: ${t}`,
    watch: 'Koʻrish',
    by: (name) => `${name} topshirdi`,
    delivery: (n, of) => `Topshirish ${n}/${of}`,
    oneLeft: 'bitta tahrir qoldi',
    limit: (n, of) => `🔒 Topshirish ${n}${n <= of ? `/${of}` : ''} — tahrir limiti tugadi, ish oʻz holicha tasdiqlandi.`,
    lastPravka: 'Bu oxirgi tahrir — keyingi topshiriq oʻz holicha tasdiqlanadi.',
    override: (name) => `${name} limitdan ortiq tahrir qoʻshdi (admin istisnosi).`,
    lateLine: (what, n) => `${what}: ${n} kun kechikdi.`,
    what: { shoot: 'Suratga olish', edit: 'Montaj', design: 'Dizayn', release: 'Chiqish' },
    footageNext: 'Montajga tayyor.',
    footageHeld: 'Sizni kutmoqda: montaj uchun kerakli narsalarni (TZ, kim montaj qiladi) qoʻshing va keyingi bosqichga yuboring.',
  },
}

export const tgWords = (lang) => W[lang] || W.en
export const TG_LANGS = Object.keys(W)
