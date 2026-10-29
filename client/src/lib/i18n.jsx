import { createContext, Fragment, useContext, useEffect, useMemo, useState } from 'react'

// Three languages, because three are spoken in this office.
//
// English is the base: every key is written here first, and it is what shows
// if a translation is missing rather than a blank or a raw key. Russian is
// what most of the team writes in day to day. Uzbek is the local language and
// the one nobody else's dashboard offers them.
//
// A NOTE ON WHAT IS TRANSLATED. The chrome is: navigation, page headings,
// buttons, the words the board uses about itself. What people TYPE — task
// titles, scripts, references, comments — is never touched, because it is
// theirs and it is already in whichever language they chose.
//
// Keys read as english.sentences.in.dots so a missing one is obvious in the
// UI rather than silently blank.

export const LANGS = [
  { key: 'en', label: 'English', native: 'English' },
  { key: 'ru', label: 'Russian', native: 'Русский' },
  { key: 'uz', label: 'Uzbek', native: 'Oʻzbekcha' },
]

const STORE = 'satashkent_lang'

// The dictionary. English carries every key; the other two are checked
// against it by the round-73 suite, so a key added here without its
// translations fails the gate rather than quietly showing English.
const EN = {
  'nav.brief': 'My Day',
  'nav.projects': 'Projects',
  'nav.releases': 'Calendar',
  'nav.recordings': 'Recordings',
  'nav.missed': 'Missed',
  'nav.team': 'Team',
  'nav.admin': 'Settings',
  'nav.profile': 'Profile',
  'nav.signout': 'Sign out',
  'nav.stats': 'Statistics',
  'nav.docs': 'Pay',
  'nav.design': 'Design',
  'nav.sprints': 'Sprints',
  'nav.channels': 'Channels',
  'nav.manage': 'Manage',
  'nav.home': 'Home',
  'nav.personalize': 'Personalize',
  'nav.donepersonalizing': 'Done',
  'nav.reset': 'Reset',
  'nav.hiddencount': '{n} hidden',
  'nav.myprofile': 'My profile — photo, name, password',
  'nav.adminpanel': 'Settings',
  'nav.myprofilepage': 'My Profile',
  'nav.projectspage': 'Projects & Campaigns',
  'nav.channel': 'Channel',
  'nav.find': 'Find anything — Ctrl K',
  'nav.quickfind': 'Quick find',
  'nav.menu': 'Menu',
  'nav.openmenu': 'Open menu',
  'nav.showside': 'Show the sidebar',
  'nav.hideside': 'Hide the sidebar — full screen for this page',

  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.add': 'Add',
  'common.edit': 'Edit',
  'common.open': 'Open',
  'common.search': 'Search',
  'common.today': 'Today',
  'common.tomorrow': 'Tomorrow',
  'common.yesterday': 'Yesterday',
  'common.nodate': 'No date',
  'common.loading': 'Loading…',
  'common.language': 'Language',
  'common.all': 'All',
  'common.none': 'None',
  'common.required': 'required',
  'common.optional': 'optional',
  'login.signin': 'Sign in',
  'login.sub': 'Marketing team workspace',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.showpw': 'Show password',
  'login.hidepw': 'Hide password',
  'login.remember': 'Remember me for a week',
  'login.rememberoff': '— off: signed out when the browser closes',
  'login.signingin': 'Signing in…',
  'login.tagline': 'College Prep Community',

  'task.new': 'New task',
  'task.title': 'Task title',
  'task.stage': 'Stage',
  'task.type': 'Type',
  'task.platforms': 'Platforms',
  'task.crew': 'Crew',
  'task.operator': 'Operator',
  'task.editor': 'Editor',
  'task.designer': 'Designer',
  'task.reviewer': 'Review',
  'task.assignees': 'Assignees',
  'task.reference': 'Reference',
  'task.script': 'Script',
  'task.description': 'Description',
  'task.checklist': 'Checklist',
  'task.documents': 'Documents',
  'task.campaign': 'Campaign',
  'task.deadlines': 'Deadlines',
  'task.shoot': 'Shoot',
  'task.editready': 'Edit ready',
  'task.designready': 'Design ready',
  'task.release': 'Release',
  'task.talk': 'Talk',
  'task.history': 'History',
  'task.create': 'Create task',
  'task.savechanges': 'Save changes',
  'task.duplicate': 'Duplicate',
  'task.publish': 'Publish',
  'task.requestchanges': 'Request Pravka',
  'task.sendback': 'Send back',
  'task.markshot': 'Mark as shot',
  'task.markedited': 'Mark as edited',
  'task.markdesigned': 'Mark as designed',
  'task.yourpart': 'Your part',
  'task.files': 'Files',
  'task.revisions': 'Revisions',
  'task.trouble': 'Trouble',
  'task.daymoves': 'Day moves',
  'task.about': 'About',
  'task.brief': 'Brief',
  'task.saving': 'Saving…',
  'task.shot': 'Shot',
  'task.edited': 'Edited',
  'task.designed': 'Designed',
  'task.sendbackto': 'Send back to:',

  'late.heading_one': '1 thing of yours is past its day',
  'late.heading_many': '{n} things of yours are past their day',
  'late.allanswered': 'Everything late is spoken for',
  'late.newday': 'New day',
  'late.saywhy': 'Say why',
  'late.finish': 'Finish it',
  'late.answered': '{n} already answered for',
  'late.phase.shoot': 'the shoot',
  'late.phase.edit': 'the edit',
  'late.phase.design': 'the artwork',
  'late.phase.release': 'the release',
  'late.day_one': 'a day late',
  'late.day_many': '{n} days late',
  'late.wasdue': 'was due {d}',
  'late.moveto': 'move to',
  'late.whathappened': 'What happened? The location fell through, the other shoot overran…',
  'late.promisedhint': 'A day that was promised moves on an admin’s yes, not before.',
  'late.ask': 'Ask',
  'late.asked': 'Asked — the admins have it',
  'late.intheway': 'What is in the way? Said now, it can still be planned around.',
  'late.sayhint': 'Goes to the people who plan, with your name on it.',
  'late.sayit': 'Say it',
  'late.said': 'Said — the people who plan have it',

  'setup.connect': 'Connect Telegram',
  'setup.connectwhy': 'Deadlines, Pravki and anything with your name on it reach you there. Right now they don’t reach you at all.',
  'setup.install': 'Put SATashkent on your home screen',
  'setup.installwhy': 'One tap and it opens like an app, with no address to remember.',
  'setup.notnow': 'Not now',
  'setup.connectbtn': 'Connect',
  'setup.opening': 'Opening…',
  'setup.install_btn': 'Install',
  'setup.ios': 'Tap Share, then “Add to Home Screen”. It opens like an app — no address to remember.',
  'setup.asknextweek': 'Not now — ask again next week',

  'admin.people': 'People',
  'admin.channels': 'Channels',
  'admin.pipeline': 'Pipeline',
  'admin.dailycap': 'Pieces a day',
  'admin.dailycaphint': 'The most this person can be given for one day. 0 means no limit.',
  'admin.crewchannels': 'Channels they work on',
  'admin.crewchannelshint': 'Nothing ticked means every channel.',
  'admin.drivefolder': 'Shared Drive folder',
  'reward.streak': '{n} days in a row',
  'reward.delivered': '{n} delivered',
  'reward.tonext': '{n} more to {m}',
  'reward.allthere': 'Every rung passed',
  'reward.thisweek': 'this week',
  'reward.thismonth': 'this month',
  'reward.ontime': 'on time',
}

const RU = {
  'nav.brief': 'Мой день',
  'nav.projects': 'Проекты',
  'nav.releases': 'Календарь',
  'nav.recordings': 'Съёмки',
  'nav.missed': 'Просрочено',
  'nav.team': 'Команда',
  'nav.admin': 'Настройки',
  'nav.profile': 'Профиль',
  'nav.signout': 'Выйти',
  'nav.stats': 'Статистика',
  'nav.docs': 'Оплата',
  'nav.design': 'Дизайн',
  'nav.sprints': 'Спринты',
  'nav.channels': 'Каналы',
  'nav.manage': 'Управление',
  'nav.home': 'Главная',
  'nav.personalize': 'Настроить',
  'nav.donepersonalizing': 'Готово',
  'nav.reset': 'Сбросить',
  'nav.hiddencount': 'скрыто: {n}',
  'nav.myprofile': 'Мой профиль — фото, имя, пароль',
  'nav.adminpanel': 'Настройки',
  'nav.myprofilepage': 'Мой профиль',
  'nav.projectspage': 'Проекты и кампании',
  'nav.channel': 'Канал',
  'nav.find': 'Найти что угодно — Ctrl K',
  'nav.quickfind': 'Быстрый поиск',
  'nav.menu': 'Меню',
  'nav.openmenu': 'Открыть меню',
  'nav.showside': 'Показать боковое меню',
  'nav.hideside': 'Скрыть боковое меню — страница на весь экран',

  'common.save': 'Сохранить',
  'common.cancel': 'Отмена',
  'common.delete': 'Удалить',
  'common.close': 'Закрыть',
  'common.add': 'Добавить',
  'common.edit': 'Изменить',
  'common.open': 'Открыть',
  'common.search': 'Поиск',
  'common.today': 'Сегодня',
  'common.tomorrow': 'Завтра',
  'common.yesterday': 'Вчера',
  'common.nodate': 'Без даты',
  'common.loading': 'Загрузка…',
  'common.language': 'Язык',
  'common.all': 'Все',
  'common.none': 'Нет',
  'common.required': 'обязательно',
  'common.optional': 'необязательно',
  'login.signin': 'Вход',
  'login.sub': 'Рабочее пространство маркетинга',
  'login.username': 'Логин',
  'login.password': 'Пароль',
  'login.showpw': 'Показать пароль',
  'login.hidepw': 'Скрыть пароль',
  'login.remember': 'Запомнить меня на неделю',
  'login.rememberoff': '— выключено: выход при закрытии браузера',
  'login.signingin': 'Входим…',
  'login.tagline': 'College Prep Community',

  'task.new': 'Новая задача',
  'task.title': 'Название задачи',
  'task.stage': 'Этап',
  'task.type': 'Тип',
  'task.platforms': 'Площадки',
  'task.crew': 'Команда',
  'task.operator': 'Оператор',
  'task.editor': 'Монтажёр',
  'task.designer': 'Дизайнер',
  'task.reviewer': 'Проверка',
  'task.assignees': 'Ответственные',
  'task.reference': 'Референс',
  'task.script': 'Сценарий',
  'task.description': 'Описание',
  'task.checklist': 'Чек-лист',
  'task.documents': 'Документы',
  'task.campaign': 'Кампания',
  'task.deadlines': 'Дедлайны',
  'task.shoot': 'Съёмка',
  'task.editready': 'Монтаж готов',
  'task.designready': 'Дизайн готов',
  'task.release': 'Публикация',
  'task.talk': 'Обсуждение',
  'task.history': 'История',
  'task.create': 'Создать задачу',
  'task.savechanges': 'Сохранить',
  'task.duplicate': 'Дублировать',
  'task.publish': 'Опубликовать',
  'task.requestchanges': 'Отправить на правку',
  'task.sendback': 'Вернуть',
  'task.markshot': 'Отснято',
  'task.markedited': 'Смонтировано',
  'task.markdesigned': 'Дизайн готов',
  'task.yourpart': 'Ваша часть',
  'task.files': 'Файлы',
  'task.revisions': 'Правки',
  'task.trouble': 'Проблема',
  'task.daymoves': 'Перенос дат',
  'task.about': 'О задаче',
  'task.brief': 'Бриф',
  'task.saving': 'Сохраняем…',
  'task.shot': 'Снято',
  'task.edited': 'Смонтировано',
  'task.designed': 'Готов дизайн',
  'task.sendbackto': 'Вернуть на:',

  'late.heading_one': 'У вас 1 просроченная задача',
  'late.heading_many': 'У вас просрочено: {n}',
  'late.allanswered': 'По всем просрочкам есть ответ',
  'late.newday': 'Новая дата',
  'late.saywhy': 'Объяснить',
  'late.finish': 'Завершить',
  'late.answered': 'уже с ответом: {n}',
  'late.phase.shoot': 'съёмка',
  'late.phase.edit': 'монтаж',
  'late.phase.design': 'дизайн',
  'late.phase.release': 'публикация',
  'late.day_one': 'опоздание на день',
  'late.day_many': 'опоздание: {n} дн.',
  'late.wasdue': 'срок был {d}',
  'late.moveto': 'перенести на',
  'late.whathappened': 'Что случилось? Локация отвалилась, другая съёмка затянулась…',
  'late.promisedhint': 'Обещанная дата двигается только с согласия админа.',
  'late.ask': 'Отправить',
  'late.asked': 'Отправлено — админы получили',
  'late.intheway': 'Что мешает? Скажете сейчас — можно успеть перестроить план.',
  'late.sayhint': 'Уйдёт тем, кто планирует, с вашим именем.',
  'late.sayit': 'Сказать',
  'late.said': 'Сказано — те, кто планирует, получили',

  'setup.connect': 'Подключить Telegram',
  'setup.connectwhy': 'Дедлайны, правки и всё, что касается вас, приходят туда. Сейчас они до вас не доходят.',
  'setup.install': 'Добавьте SATashkent на главный экран',
  'setup.installwhy': 'Одно касание — и открывается как приложение, без адреса.',
  'setup.notnow': 'Позже',
  'setup.connectbtn': 'Подключить',
  'setup.opening': 'Открываем…',
  'setup.install_btn': 'Установить',
  'setup.ios': 'Нажмите «Поделиться», затем «На экран «Домой»». Откроется как приложение — адрес запоминать не нужно.',
  'setup.asknextweek': 'Не сейчас — напомнить через неделю',

  'admin.people': 'Люди',
  'admin.channels': 'Каналы',
  'admin.pipeline': 'Процесс',
  'admin.dailycap': 'Задач в день',
  'admin.dailycaphint': 'Сколько максимум можно дать этому человеку на один день. 0 — без ограничения.',
  'admin.crewchannels': 'Каналы, где он работает',
  'admin.crewchannelshint': 'Если ничего не отмечено — все каналы.',
  'admin.drivefolder': 'Общая папка на Диске',
  'reward.streak': '{n} дн. подряд',
  'reward.delivered': 'сдано: {n}',
  'reward.tonext': 'ещё {n} до {m}',
  'reward.allthere': 'Все рубежи взяты',
  'reward.thisweek': 'за неделю',
  'reward.thismonth': 'за месяц',
  'reward.ontime': 'в срок',
}

const UZ = {
  'nav.brief': 'Mening kunim',
  'nav.projects': 'Loyihalar',
  'nav.releases': 'Taqvim',
  'nav.recordings': 'Suratga olish',
  'nav.missed': 'Kechikkan',
  'nav.team': 'Jamoa',
  'nav.admin': 'Sozlamalar',
  'nav.profile': 'Profil',
  'nav.signout': 'Chiqish',
  'nav.stats': 'Statistika',
  'nav.docs': 'Toʻlov',
  'nav.design': 'Dizayn',
  'nav.sprints': 'Sprintlar',
  'nav.channels': 'Kanallar',
  'nav.manage': 'Boshqaruv',
  'nav.home': 'Bosh sahifa',
  'nav.personalize': 'Sozlash',
  'nav.donepersonalizing': 'Tayyor',
  'nav.reset': 'Tiklash',
  'nav.hiddencount': 'yashirilgan: {n}',
  'nav.myprofile': 'Mening profilim — rasm, ism, parol',
  'nav.adminpanel': 'Sozlamalar',
  'nav.myprofilepage': 'Mening profilim',
  'nav.projectspage': 'Loyihalar va kampaniyalar',
  'nav.channel': 'Kanal',
  'nav.find': 'Hamma narsani topish — Ctrl K',
  'nav.quickfind': 'Tezkor qidiruv',
  'nav.menu': 'Menyu',
  'nav.openmenu': 'Menyuni ochish',
  'nav.showside': 'Yon menyuni koʻrsatish',
  'nav.hideside': 'Yon menyuni yashirish — sahifa butun ekranda',

  'common.save': 'Saqlash',
  'common.cancel': 'Bekor qilish',
  'common.delete': 'Oʻchirish',
  'common.close': 'Yopish',
  'common.add': 'Qoʻshish',
  'common.edit': 'Tahrirlash',
  'common.open': 'Ochish',
  'common.search': 'Qidirish',
  'common.today': 'Bugun',
  'common.tomorrow': 'Ertaga',
  'common.yesterday': 'Kecha',
  'common.nodate': 'Sanasiz',
  'common.loading': 'Yuklanmoqda…',
  'common.language': 'Til',
  'common.all': 'Hammasi',
  'common.none': 'Yoʻq',
  'common.required': 'majburiy',
  'common.optional': 'ixtiyoriy',
  'login.signin': 'Kirish',
  'login.sub': 'Marketing jamoasi ish maydoni',
  'login.username': 'Login',
  'login.password': 'Parol',
  'login.showpw': 'Parolni koʻrsatish',
  'login.hidepw': 'Parolni yashirish',
  'login.remember': 'Meni bir hafta eslab qol',
  'login.rememberoff': '— oʻchiq: brauzer yopilganda chiqadi',
  'login.signingin': 'Kirilmoqda…',
  'login.tagline': 'College Prep Community',

  'task.new': 'Yangi vazifa',
  'task.title': 'Vazifa nomi',
  'task.stage': 'Bosqich',
  'task.type': 'Turi',
  'task.platforms': 'Platformalar',
  'task.crew': 'Jamoa',
  'task.operator': 'Operator',
  'task.editor': 'Montajchi',
  'task.designer': 'Dizayner',
  'task.reviewer': 'Tekshiruv',
  'task.assignees': 'Masʼullar',
  'task.reference': 'Referens',
  'task.script': 'Ssenariy',
  'task.description': 'Tavsif',
  'task.checklist': 'Roʻyxat',
  'task.documents': 'Hujjatlar',
  'task.campaign': 'Kampaniya',
  'task.deadlines': 'Muddatlar',
  'task.shoot': 'Suratga olish',
  'task.editready': 'Montaj tayyor',
  'task.designready': 'Dizayn tayyor',
  'task.release': 'Chiqish',
  'task.talk': 'Muhokama',
  'task.history': 'Tarix',
  'task.create': 'Vazifa yaratish',
  'task.savechanges': 'Saqlash',
  'task.duplicate': 'Nusxalash',
  'task.publish': 'Chiqarish',
  'task.requestchanges': 'Tahrirga yuborish',
  'task.sendback': 'Qaytarish',
  'task.markshot': 'Suratga olindi',
  'task.markedited': 'Montaj qilindi',
  'task.markdesigned': 'Dizayn tayyor',
  'task.yourpart': 'Sizning qismingiz',
  'task.files': 'Fayllar',
  'task.revisions': 'Tuzatishlar',
  'task.trouble': 'Muammo',
  'task.daymoves': 'Sana koʻchirish',
  'task.about': 'Vazifa haqida',
  'task.brief': 'Brif',
  'task.saving': 'Saqlanmoqda…',
  'task.shot': 'Suratga olindi',
  'task.edited': 'Montaj qilindi',
  'task.designed': 'Dizayn tayyor',
  'task.sendbackto': 'Qaytarish:',

  'late.heading_one': 'Sizda 1 ta muddati oʻtgan ish bor',
  'late.heading_many': 'Sizda muddati oʻtgan ishlar: {n}',
  'late.allanswered': 'Barcha kechikishlarga javob berilgan',
  'late.newday': 'Yangi sana',
  'late.saywhy': 'Sababini ayting',
  'late.finish': 'Yakunlash',
  'late.answered': 'javob berilgan: {n}',
  'late.phase.shoot': 'suratga olish',
  'late.phase.edit': 'montaj',
  'late.phase.design': 'dizayn',
  'late.phase.release': 'chiqarish',
  'late.day_one': 'bir kun kechikdi',
  'late.day_many': '{n} kun kechikdi',
  'late.wasdue': 'muddati {d} edi',
  'late.moveto': 'koʻchirish sanasi',
  'late.whathappened': 'Nima boʻldi? Joy bekor boʻldi, boshqa suratga olish choʻzildi…',
  'late.promisedhint': 'Vaʼda qilingan sana faqat admin roziligi bilan koʻchadi.',
  'late.ask': 'Yuborish',
  'late.asked': 'Yuborildi — adminlarda',
  'late.intheway': 'Nima xalaqit beryapti? Hozir aytilsa, rejani oʻzgartirishga ulguriladi.',
  'late.sayhint': 'Reja tuzuvchilarga, sizning ismingiz bilan boradi.',
  'late.sayit': 'Aytish',
  'late.said': 'Aytildi — reja tuzuvchilarda',

  'setup.connect': 'Telegramni ulash',
  'setup.connectwhy': 'Muddatlar, tuzatishlar va sizga tegishli hamma narsa oʻsha yerga keladi. Hozir sizga umuman yetib bormayapti.',
  'setup.install': 'SATashkentʼni bosh ekranga qoʻshing',
  'setup.installwhy': 'Bir bosishda ilova kabi ochiladi, manzilni eslab qolish shart emas.',
  'setup.notnow': 'Keyinroq',
  'setup.connectbtn': 'Ulash',
  'setup.opening': 'Ochilmoqda…',
  'setup.install_btn': 'Oʻrnatish',
  'setup.ios': '«Ulashish»ni, soʻng «Bosh ekranga qoʻshish»ni bosing. Ilova kabi ochiladi — manzilni eslab qolish shart emas.',
  'setup.asknextweek': 'Hozir emas — keyingi hafta soʻralsin',

  'admin.people': 'Odamlar',
  'admin.channels': 'Kanallar',
  'admin.pipeline': 'Jarayon',
  'admin.dailycap': 'Kuniga nechta',
  'admin.dailycaphint': 'Bu odamga bir kunga koʻpi bilan nechta ish berish mumkin. 0 — cheklovsiz.',
  'admin.crewchannels': 'U ishlaydigan kanallar',
  'admin.crewchannelshint': 'Hech biri belgilanmasa — barcha kanallar.',
  'admin.drivefolder': 'Umumiy Drive papkasi',
  'reward.streak': 'ketma-ket {n} kun',
  'reward.delivered': 'topshirildi: {n}',
  'reward.tonext': '{m} gacha yana {n} ta',
  'reward.allthere': 'Barcha bosqichlar bosib oʻtildi',
  'reward.thisweek': 'shu hafta',
  'reward.thismonth': 'shu oy',
  'reward.ontime': 'muddatida',
}

export const DICTS = { en: EN, ru: RU, uz: UZ }

// ---- the phrase book ------------------------------------------------------
//
// The dictionaries above are keyed english.like.this, which is right for the
// words the board reuses everywhere — navigation, buttons, the names of
// things. It is the wrong shape for the several hundred SENTENCES scattered
// through the pages: inventing a key for "Nothing scheduled in the next 7
// days" and then maintaining the pairing is work that buys nothing, and a
// call site reading t('brief.empty7') tells a reader nothing about what will
// appear on screen.
//
// So `t` takes either. If what you pass is not a key, it is treated as the
// English itself and looked up in the phrase book below — which means the
// English needs no entry at all, the call site stays readable, and a phrase
// nobody has translated yet shows in English rather than as a raw key.
//
// The cost of this shape is that editing an English sentence orphans its
// translations silently. The round-74 suite guards it: every phrase the
// codebase asks for must be present in both books, or the gate fails.

// The books themselves live in i18n.ru.js and i18n.uz.js and are loaded on
// demand: a Russian reader downloads the Russian book and never the Uzbek one.
// Until the chosen book has landed, `lookup` falls through to the English —
// the same thing it does for a phrase nobody has translated yet — and the
// provider below holds the page back until the book is there, so nobody sees
// an English screen turn Russian a moment later.
//
// PHRASES keeps its shape (`PHRASES.ru["…"]`): a book is filled in when its
// file arrives, and stays so for the life of the page.
const PHRASES = { ru: null, uz: null }
const BOOK = { ru: () => import('./i18n.ru.js'), uz: () => import('./i18n.uz.js') }
const settled = new Set(['en']) // languages whose book is in (or was given up on)
const loading = {}
const watchers = new Set()
// Fetch a language's book, once. Resolves when it is in PHRASES — or when the
// fetch failed, in which case the language stays English until a reload; a
// chunk a deploy has removed is caught by the vite:preloadError guard in
// main.jsx, which reloads the page.
export function loadBook(code) {
  if (!BOOK[code] || settled.has(code)) return Promise.resolve()
  if (!loading[code]) {
    loading[code] = BOOK[code]()
      .then((m) => { PHRASES[code] = m.default })
      .catch(() => { /* English until the next load */ })
      .then(() => { settled.add(code); for (const w of watchers) w(code) })
  }
  return loading[code]
}
// Is the book of a language (the current one by default) in?
export const bookReady = (code = current) => settled.has(code)

// Both spellings of "is this translated": a dotted key, or the English text.
const lookup = (lang, key) => DICTS[lang]?.[key] ?? PHRASES[lang]?.[key] ?? EN[key] ?? key

export { PHRASES }

const I18n = createContext({ lang: 'en', t: (k) => EN[k] || k, setLang: () => {} })

// The language the browser is already asking for, so a Russian-speaking phone
// opens in Russian without anybody being told there is a setting.
const guess = () => {
  try {
    const saved = localStorage.getItem(STORE)
    if (saved && DICTS[saved]) return saved
  } catch { /* private window */ }
  const want = (navigator.languages || [navigator.language || 'en']).join(',').toLowerCase()
  if (/\buz\b|uz-/.test(want)) return 'uz'
  if (/\bru\b|ru-/.test(want)) return 'ru'
  return 'en'
}

// The language, kept in a module variable so `tr` below can translate from
// anywhere without a hook and without touching storage three hundred times a
// render.
//
// It is settled HERE, at module load, and not by the provider — because a
// good deal of the board's text lives in constant arrays (the hiring stages,
// the crew hats, the report presets) that are built the moment their module
// is imported, which is before React has rendered anything. Those arrays get
// the right language only if the language is already known by then. Every
// module that translates imports this one, so this line runs first.
let current = guess()
// …and its book is asked for in the same breath, so the fetch is on its way
// while the rest of the page is still being parsed.
loadBook(current)

// The BCP-47 tag per language. One table: the document declares it, dates and
// numbers are formatted with it, and a native date input takes its field order
// from it. Declared above everything that reads it rather than below, because
// a const in the temporal dead zone works here only by the accident of an
// effect running late.
const LOCALE_TAG = { en: 'en-GB', ru: 'ru-RU', uz: 'uz-UZ' }

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(current)
  // Counts the books that have landed, so the page is rendered again — never
  // remounted — when one does: the chosen one at start-up (the children are
  // held back until then, see below), another one later when `phraseIn`
  // asked for it.
  const [books, setBooks] = useState(0)
  const ready = bookReady(lang)
  useEffect(() => {
    const w = () => setBooks((n) => n + 1)
    watchers.add(w)
    // The book may have landed between the render above and this effect.
    if (bookReady(lang) !== ready) w()
    return () => watchers.delete(w)
  }, [lang, ready])
  const setLang = (next) => {
    if (!DICTS[next]) return
    current = next
    setLangState(next)
    try { localStorage.setItem(STORE, next) } catch { /* private window */ }
    loadBook(next) // so the reload below finds it in the cache
    // And start again in the new language.
    //
    // The constant arrays above were built at import time and will not be
    // built again; re-rendering would leave the hiring stages and the crew
    // hats in the language the page opened in, which is a worse result than
    // either language on its own. A reload is one second, it happens about
    // once per person per lifetime, and it makes every string on the board
    // agree. React's own re-render is kept as well, so anything the reload
    // does not reach has already changed by the time it lands.
    setTimeout(() => { try { window.location.reload() } catch { /* fine */ } }, 60)
  }
  // The FULL tag, not the bare two letters. A native <input type="date">
  // takes its format from the document's language, and "en" means American
  // English to every browser — so a board built for Tashkent was asking its
  // team for mm/dd/yyyy. "en-GB" is the same English with the day first,
  // which is the order everybody reading this board writes dates in. The
  // tag the rest of the app already formats with, so a date typed into a box
  // and a date printed beside it cannot disagree.
  useEffect(() => { document.documentElement.lang = LOCALE_TAG[lang] || lang }, [lang])

  const value = useMemo(() => ({
    lang,
    setLang,
    // English is the fallback, never a blank and never the raw key: a missing
    // translation should read as slightly wrong, not as broken.
    t: (key, vars) => {
      let out = lookup(lang, key)
      if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
      return out
    },
  }), [lang, books])
  // Keyed on the language, so switching it remounts the tree.
  //
  // Almost every string on this board is translated by `tr`, a plain function
  // rather than a hook — which is what lets a toast fired from a callback and
  // a label deep inside a list say the same thing without either of them
  // having to be a component. The cost is that React has no idea the
  // translation changed. One key fixes that for all of it: change the
  // language and everything below is built again, in the new one. It happens
  // about once per person per lifetime, and losing a half-typed form to it is
  // the correct trade.
  //
  // And nothing is drawn until the book of the chosen language is in. The book
  // is a chunk of its own, asked for the moment this module loads; the wait is
  // the one round trip the page already spends asking the server who is signed
  // in. Painting the English first and the Russian a moment later would be a
  // flash of the wrong language on every open — and it would leave the constant
  // arrays the lazy pages build at import time (the hiring stages, the crew
  // hats) in English until a reload. Held back, those pages are only ever
  // fetched once the book is in.
  return <I18n.Provider value={value}><Fragment key={lang}>{ready ? children : null}</Fragment></I18n.Provider>
}

export const useT = () => useContext(I18n)

// The BCP-47 tag for whatever language is on, so dates and numbers follow it
// too. The board greeted a Russian speaker with "Sunday 23 August" in
// Russian-labelled chrome, which is the giveaway that a translation is a
// veneer: the words changed and the machinery underneath did not.
export const locale = () => LOCALE_TAG[current] || 'en-GB'

// The two-letter code itself, for the places that send the language TO
// something rather than reading it — the assistant, which has to be told
// which language to answer in.
export const lang = () => current

// The same translator, outside React.
//
// Toasts, alerts and confirms are fired from plain functions where there is
// no component to hold a hook, and they are some of the most-read text on the
// board — "Published — synced" is seen fifty times a day. This reads the
// chosen language straight from storage each call, which costs nothing at
// these rates and cannot go stale: there is no render to miss.
export function tr(key, vars) {
  let out = lookup(current, key)
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
  return out
}
// The same phrase in the language of whoever will READ it. A line written into
// a task's thread for one person — a reminder — is read by them, in their
// language, not in the language of the person who pressed the button.
//
// That language's book may not be in yet — only the reader's own is fetched at
// start-up. Asking for it starts the fetch, and the English is returned until
// it lands (the provider renders again when it does). The first ask is a look
// at a thread, seconds before anybody presses "Remind", so the line written is
// in the right language.
export const phraseIn = (code, key) => {
  const l = DICTS[code] ? code : current
  if (!bookReady(l)) loadBook(l)
  return lookup(l, key)
}
