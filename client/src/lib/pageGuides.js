// What each page is for, and the handful of things people get wrong on it.
//
// Kept here rather than in the phrase book for the same reason the sprint
// guide is: this is a document, not a set of labels, and a phrase book keyed
// on English sentences would turn it into a hundred keys nobody could read as
// a whole.
//
// House rule for this text, the same one the sprint guide follows: no dashes
// anywhere, in any language. Short sentences, exact numbers, no encouragement.
// If a rule the board enforces is not written here, somebody will read it as a
// bug the first time it refuses them.
export const PAGE_GUIDES = {
  schedule: {
    en: [
      { h: 'What this page is', p: [
        'Every piece of work with a date on it, on one calendar.',
        'Releases shows the day a piece goes out. Recordings shows the day it is filmed.',
        'You see the whole team here, not only your own channels. Who is filming on Thursday is a question anybody can answer.',
      ] },
      { h: 'The colours', p: [
        'Every block wears the colour of the stage it is at. The stages and their colours are listed below.',
        'A block that is struck through was deleted. It stays on the record.',
      ] },
      { h: 'Moving a day', p: [
        'Drag a block to another day.',
        'A day that is already promised does not move for anybody but an admin. Ask, and say what happened.',
        'An idea is not a promise. Its days move freely, by anybody, until it leaves the idea stage.',
      ] },
      { h: 'A crowded day', p: [
        'Every cell is the same height. A day with more on it than fits scrolls inside its own cell.',
        'Click the empty part of a day to open that day whole, in order, with the times.',
      ] },
    ],
    ru: [
      { h: 'Что это за страница', p: [
        'Вся работа, у которой есть дата, в одном календаре.',
        'Releases показывает день выхода. Recordings показывает день съёмки.',
        'Здесь видно всю команду, а не только ваши каналы. Кто снимает в четверг, может ответить каждый.',
      ] },
      { h: 'Цвета', p: [
        'Каждый блок носит цвет своего этапа. Этапы и их цвета перечислены ниже.',
        'Зачёркнутый блок удалён. Он остаётся в истории.',
      ] },
      { h: 'Перенос дня', p: [
        'Перетащите блок на другой день.',
        'Обещанный день двигает только админ. Попросите и скажите, что случилось.',
        'Идея не обещание. Её дни двигает кто угодно, пока она остаётся идеей.',
      ] },
      { h: 'Плотный день', p: [
        'Все ячейки одной высоты. День, где не всё помещается, прокручивается внутри своей ячейки.',
        'Нажмите на пустую часть дня, чтобы открыть весь день по порядку, со временем.',
      ] },
    ],
    uz: [
      { h: 'Bu qanday sahifa', p: [
        'Sanasi bor barcha ish bitta kalendarda.',
        'Releases chiqish kunini, Recordings suratga olish kunini koʻrsatadi.',
        'Bu yerda butun jamoa koʻrinadi, faqat oʻz kanallaringiz emas. Payshanba kuni kim suratga oladi degan savolga har kim javob bera oladi.',
      ] },
      { h: 'Ranglar', p: [
        'Har bir blok oʻz bosqichining rangida. Bosqichlar va ularning ranglari quyida.',
        'Chizilgan blok oʻchirilgan. U tarixda qoladi.',
      ] },
      { h: 'Kunni koʻchirish', p: [
        'Blokni boshqa kunga torting.',
        'Vaʼda qilingan kunni faqat admin koʻchiradi. Soʻrang va nima boʻlganini ayting.',
        'Gʻoya vaʼda emas. U gʻoya boʻlib turganda kunlarini istalgan odam koʻchiradi.',
      ] },
      { h: 'Band kun', p: [
        'Har bir katak bir xil balandlikda. Sigʻmagan kun oʻz katagi ichida aylanadi.',
        'Kunning boʻsh joyiga bosing va butun kun tartib bilan, vaqtlari bilan ochiladi.',
      ] },
    ],
  },
  // The Master Calendar (/calendar). It was the Releases page and opened the
  // `schedule` guide above, which it has outgrown: that one names it Releases,
  // tells everybody an idea's day is theirs to move (here it is not), and has
  // nothing to say about picking several cards or about the phone, which are
  // the two things on this page most likely to be read as a bug. Recordings
  // and the channel boards' own calendars still work the way `schedule` says,
  // so they keep it.
  calendar: {
    en: [
      { h: 'What this page is', p: [
        'The Master Calendar. Everything that goes out, on the day it goes out, on every channel.',
        'Several channels show at once. Press a channel to add it, and press it again to take it off. All channels shows every one.',
        'Unless exactly one channel is picked, every card says which channel it goes out on.',
        'A campaign or a project can open this page on its own cards only. The chip above the grid says so. Press its cross to see everything again.',
        'Work with no release day is not on the grid. The line under the grid counts it.',
      ] },
      { h: 'The colours', p: [
        'Every card wears the colour of the stage it is at. The stages and their colours are listed below.',
      ] },
      { h: 'Moving a day', p: [
        'Drag a card to another day.',
        'A day moves only for somebody who may move tasks, and only on work that is theirs: on one of their channels, or with their name on it. Every other channel is here to be seen, not moved.',
        'On this page an idea follows the same rule. It does not move for everybody the way it does on a channel board.',
        'A day that is already promised is for an admin to move. So are the days of a piece that is being made.',
        'Drag one anyway and the calendar offers Ask to move. It opens the task with the day you dragged to already in it. Say what happened, and an admin answers.',
        'Pull a release earlier and the edit and artwork it waits on come with it. A release never goes before a shoot that has not happened yet. Move the shoot first.',
      ] },
      { h: 'Moving several at once', p: [
        'Hold Shift, Ctrl or ⌘ and click cards to pick them. From the keyboard, press Space on a card. Enter opens it.',
        'Bulk Actions appears at the bottom. Choose a stage in Move to stage, and every picked card goes there through one window.',
        'The window checks each card first. A red row still needs something for that stage, and its boxes are right there on the row. Fill them and press Check.',
        'Where no box can answer, the row offers the task itself.',
        'The cards that are ready move together. A red row stays where it is until its boxes are filled.',
        'Only somebody who may move tasks can pick cards. Esc lets go of all of them.',
      ] },
      { h: 'A new task', p: [
        'A task needs a channel to live on. Pick exactly one channel, and every day in the week view has a plus for a new task there. An opened day has Add as well.',
        'Opened from a campaign, the new task joins that campaign.',
      ] },
      { h: 'A crowded day', p: [
        'Every cell is the same height. A day with more on it than fits scrolls inside its own cell.',
        'Click the empty part of a day to open its releases whole, in order, with the times.',
      ] },
      { h: 'On a phone', p: [
        'On a phone the calendar is for looking. Cards do not drag, cannot be picked, and no task is added from it.',
        'Tap a card to open it. A phone on its side counts as a phone too.',
      ] },
    ],
    ru: [
      { h: 'Что это за страница', p: [
        'Общий календарь. Всё, что выходит, в день выхода, по всем каналам.',
        'Несколько каналов видны сразу. Нажмите на канал, чтобы добавить его, и ещё раз, чтобы убрать. «Все каналы» показывает все.',
        'Если выбран не ровно один канал, на каждой карточке написано, в каком канале она выходит.',
        'Кампания или проект могут открыть эту страницу только со своими карточками. Об этом говорит метка над календарём. Нажмите на её крестик, чтобы снова видеть всё.',
        'Работа без дня выхода в календарь не попадает. Строка под календарём её считает.',
      ] },
      { h: 'Цвета', p: [
        'Каждая карточка носит цвет своего этапа. Этапы и их цвета перечислены ниже.',
      ] },
      { h: 'Перенос дня', p: [
        'Перетащите карточку на другой день.',
        'День двигает только тот, у кого есть право переносить задачи, и только в своей работе: в одном из своих каналов или там, где стоит его имя. Остальные каналы здесь, чтобы их видеть, а не двигать.',
        'Идея на этой странице подчиняется тому же правилу. В отличие от доски канала, её двигает не каждый.',
        'Обещанный день двигает админ. Дни работы, которая уже делается, тоже.',
        'Если всё же перетащить такую карточку, календарь предложит «Попросить перенос». Откроется задача, где уже стоит день, на который вы тянули. Скажите, что случилось, и админ ответит.',
        'Если сдвинуть выход раньше, монтаж и макет, которых он ждёт, сдвинутся вместе с ним. Выход не встанет раньше съёмки, которой ещё не было. Сначала перенесите съёмку.',
      ] },
      { h: 'Несколько сразу', p: [
        'Зажмите Shift, Ctrl или ⌘ и нажимайте на карточки, чтобы выбрать их. С клавиатуры нажмите пробел на карточке. Enter её открывает.',
        'Внизу появятся «Массовые действия». Выберите этап в «Перенести на этап», и все выбранные карточки перейдут туда через одно окно.',
        'Окно сначала проверяет каждую карточку. Красной строке ещё чего-то не хватает для этого этапа, и поля для этого прямо в строке. Заполните их и нажмите «Проверить».',
        'Где поле не поможет, строка предлагает открыть саму задачу.',
        'Готовые карточки переходят вместе. Красная строка остаётся на месте, пока её поля не заполнены.',
        'Выбирать карточки может только тот, у кого есть право переносить задачи. Esc снимает весь выбор.',
      ] },
      { h: 'Новая задача', p: [
        'Задаче нужен канал. Выберите ровно один канал, и у каждого дня на неделе появится плюс для новой задачи в нём. У открытого дня есть «Добавить».',
        'Если календарь открыт из кампании, новая задача попадает в эту кампанию.',
      ] },
      { h: 'Плотный день', p: [
        'Все ячейки одной высоты. День, где не всё помещается, прокручивается внутри своей ячейки.',
        'Нажмите на пустую часть дня, чтобы открыть все его выходы по порядку, со временем.',
      ] },
      { h: 'На телефоне', p: [
        'На телефоне календарь для просмотра. Карточки не перетаскиваются и не выбираются, а задачу отсюда не добавить.',
        'Нажмите на карточку, чтобы открыть её. Телефон, повёрнутый набок, тоже считается телефоном.',
      ] },
    ],
    uz: [
      { h: 'Bu qanday sahifa', p: [
        'Umumiy taqvim. Chiqadigan hamma narsa, chiqadigan kunida, barcha kanallar boʻyicha.',
        'Bir vaqtda bir nechta kanal koʻrinadi. Kanalni qoʻshish uchun uni bosing, olib tashlash uchun yana bosing. «Barcha kanallar» hammasini koʻrsatadi.',
        'Aynan bitta kanal tanlanmagan boʻlsa, har bir karta qaysi kanalda chiqishini aytadi.',
        'Kampaniya yoki loyiha bu sahifani faqat oʻz kartalari bilan ochishi mumkin. Buni taqvim ustidagi yorliq aytadi. Hammasini yana koʻrish uchun undagi xochni bosing.',
        'Chiqish kuni yoʻq ishlar taqvimga tushmaydi. Taqvim ostidagi qator ularni sanaydi.',
      ] },
      { h: 'Ranglar', p: [
        'Har bir karta oʻz bosqichining rangida. Bosqichlar va ularning ranglari quyida.',
      ] },
      { h: 'Kunni koʻchirish', p: [
        'Kartani boshqa kunga torting.',
        'Kunni faqat vazifalarni koʻchirish huquqi bor odam koʻchiradi va faqat oʻz ishida: oʻz kanallaridan birida yoki oʻz ismi yozilgan ishda. Boshqa kanallar bu yerda koʻrish uchun, koʻchirish uchun emas.',
        'Bu sahifada gʻoya ham shu qoidaga boʻysunadi. Kanal doskasidan farqli oʻlaroq, uni istalgan odam koʻchira olmaydi.',
        'Vaʼda qilingan kunni admin koʻchiradi. Tayyorlanayotgan ishning kunlari ham shunday.',
        'Baribir tortsangiz, taqvim «Koʻchirishni soʻrash» ni taklif qiladi. U vazifani siz tortgan kun bilan ochadi. Nima boʻlganini ayting, admin javob beradi.',
        'Chiqishni oldinroqqa tortsangiz, u kutayotgan montaj va dizayn kunlari ham birga keladi. Chiqish hali boʻlmagan suratga olishdan oldin boʻla olmaydi. Avval suratga olishni koʻchiring.',
      ] },
      { h: 'Bir nechtasini birga', p: [
        'Kartalarni tanlash uchun Shift, Ctrl yoki ⌘ ni bosib turib ularni bosing. Klaviaturadan kartada Probelni bosing. Enter uni ochadi.',
        'Pastda «Ommaviy harakatlar» paydo boʻladi. «Bosqichga oʻtkazish» da bosqichni tanlang va barcha tanlangan kartalar bitta oynada oʻsha yerga oʻtadi.',
        'Oyna avval har bir kartani tekshiradi. Qizil qatorga shu bosqich uchun yana nimadir kerak va uning maydonlari shu qatorning oʻzida. Ularni toʻldiring va «Tekshirish» ni bosing.',
        'Maydon yordam bera olmaydigan joyda qator vazifaning oʻzini ochishni taklif qiladi.',
        'Tayyor kartalar birga oʻtadi. Qizil qator maydonlari toʻldirilmaguncha joyida qoladi.',
        'Kartalarni faqat vazifalarni koʻchirish huquqi bor odam tanlay oladi. Esc hammasini bekor qiladi.',
      ] },
      { h: 'Yangi vazifa', p: [
        'Vazifaga kanal kerak. Aynan bitta kanalni tanlang va hafta koʻrinishida har bir kunda shu kanal uchun yangi vazifa qoʻshadigan plyus paydo boʻladi. Ochilgan kunda «Qoʻshish» bor.',
        'Taqvim kampaniyadan ochilgan boʻlsa, yangi vazifa shu kampaniyaga qoʻshiladi.',
      ] },
      { h: 'Band kun', p: [
        'Har bir katak bir xil balandlikda. Sigʻmagan kun oʻz katagi ichida aylanadi.',
        'Kunning boʻsh joyiga bosing va uning barcha chiqishlari tartib bilan, vaqtlari bilan ochiladi.',
      ] },
      { h: 'Telefonda', p: [
        'Telefonda taqvim koʻrish uchun. Kartalar tortilmaydi, tanlanmaydi va bu yerdan vazifa qoʻshilmaydi.',
        'Kartani ochish uchun unga bosing. Yonboshiga burilgan telefon ham telefon hisoblanadi.',
      ] },
    ],
  },
  board: {
    en: [
      { h: 'What this page is', p: [
        'One channel, its whole pipeline, as columns.',
        'A card sits in the stage it has reached. Drag it to move it on.',
      ] },
      { h: 'What the board will refuse', p: [
        'Moving a piece into a stage that needs somebody will ask who. Name them and the move goes through.',
        'An idea moves freely. Anybody can push one along, and its days are not promises yet.',
        'Once a piece is being made, its days are settled until it is up for review.',
      ] },
      { h: 'The colours', p: [
        'The dot on each column is that stage colour. The same colour follows the piece onto every calendar.',
      ] },
    ],
    ru: [
      { h: 'Что это за страница', p: [
        'Один канал и весь его пайплайн в виде колонок.',
        'Карточка стоит в том этапе, до которого дошла. Перетащите её дальше.',
      ] },
      { h: 'Что доска не разрешит', p: [
        'Перенос в этап, которому нужен человек, спросит кто. Назовите его, и перенос пройдёт.',
        'Идея двигается свободно. Её толкает кто угодно, и её дни ещё не обещание.',
        'Когда работа делается, её дни закреплены до review.',
      ] },
      { h: 'Цвета', p: [
        'Точка на колонке это цвет этапа. Тот же цвет идёт за работой во все календари.',
      ] },
    ],
    uz: [
      { h: 'Bu qanday sahifa', p: [
        'Bitta kanal va uning butun quvuri ustunlar koʻrinishida.',
        'Karta oʻzi yetgan bosqichda turadi. Uni oldinga torting.',
      ] },
      { h: 'Doska nimani rad etadi', p: [
        'Odam talab qiladigan bosqichga koʻchirish kimligini soʻraydi. Nomini ayting va koʻchish oʻtadi.',
        'Gʻoya erkin harakatlanadi. Uni har kim surishi mumkin va kunlari hali vada emas.',
        'Ish qilinayotganda kunlari review gacha qotib turadi.',
      ] },
      { h: 'Ranglar', p: [
        'Ustundagi nuqta bosqich rangi. Xuddi shu rang ishni barcha kalendarlarga ergashadi.',
      ] },
    ],
  },
}
