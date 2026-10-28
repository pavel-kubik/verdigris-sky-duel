/*
 * Verdigris Sky Duel - translations (solo, co-op and campaign).
 * Adding a language: add an entry to LANGS and a dictionary to DICT with the same keys as `en`.
 * Missing keys fall back to English, so a partial dictionary still works.
 *
 * Values are strings with {param} placeholders, or plural objects keyed by
 * Intl.PluralRules categories ({one, few, many, other}); the plural count is params.n.
 * Markup: data-i18n="key" (textContent), data-i18n-attr="attr:key;attr:key".
 */
(function () {
  'use strict';
  const LANGS = [
    { code: 'en', label: 'EN', name: 'English' },
    { code: 'cs', label: 'CS', name: 'Čeština' },
  ];
  const STORE_KEY = 'vsd-lang';

  const DICT = {
    en: {
      'lang.label': 'Language',
      'install.btn': 'Install app',
      'install.ios': 'To install, tap Share and then Add to Home Screen.',
      'install.done': 'Installed. You can now start the game from your home screen.',
      'key.space': 'Space',

      'hud.vitality': 'Vitality',
      'hud.fire': 'Fire',
      'hud.wave': 'Wave',
      'hud.score': 'Score',
      'hud.pause': 'Pause',
      'hud.foes': { one: '{n} wyvern', other: '{n} wyverns' },
      'btn.roll': 'Roll', 'btn.ball': 'Ball', 'btn.boost': 'Boost', 'btn.breath': 'Breath',
      'legend.turn': 'Turn', 'legend.pitch': 'Climb / dive', 'legend.breath': 'Fire breath', 'legend.ball': 'Fireball',
      'legend.boost': 'Boost', 'legend.roll': 'Barrel roll', 'legend.pause': 'Pause', 'legend.menu': 'Menu',
      'banner.wave': 'Wave {n}',
      'banner.waveFoes': { one: '{n} crimson wyvern', other: '{n} crimson wyverns' },
      'banner.cleared': 'Wave {n} cleared',
      'banner.vit30': '+30 vitality',
      'btn.resume': 'Resume',
      'btn.again': 'Fly again',

      /* solo */
      'solo.title': 'Verdigris Sky Duel',
      'solo.desc': 'Fly a procedural low-poly green dragon and duel waves of crimson wyverns in your browser.',
      'solo.loading': 'Hatching the dragon',
      'solo.engineFail': '3D engine failed to load',
      'intro.eyebrow': 'Procedural 3D model',
      'intro.span': 'Wingspan', 'intro.len': 'Length', 'intro.mesh': 'Meshes',
      'intro.text': 'A green wyrm built from primitives in Three.js. Drag to orbit, scroll or pinch to zoom.',
      'intro.learn': 'Learn to fly', 'intro.replay': 'Replay tutorial', 'intro.duel': 'Start the duel',
      'intro.coop': 'Co-op multiplayer (beta)',
      'intro.campaign': 'Campaign (alpha)',
      'intro.k.turn': 'Turn and bank', 'intro.k.pitch': 'Climb / dive', 'intro.k.breath': 'Fire breath (hold) or left mouse',
      'intro.k.ball': 'Fireball, auto-aims, or right mouse', 'intro.k.boost': 'Boost (uses fire)', 'intro.k.roll': 'Barrel roll, dodges fire',
      'intro.t.stick': 'Left stick', 'intro.t.stickD': 'Steer, climb and dive', 'intro.t.breath': 'Breath', 'intro.t.breathD': 'Hold for a fire stream',
      'intro.t.ballroll': 'Ball / Roll', 'intro.t.ballrollD': 'Fireball, dodge roll',
      'pause.eyebrow': 'Paused', 'pause.title': 'Wings folded',
      'pause.restart': 'Restart lesson', 'pause.skip': 'Skip lesson', 'pause.view': 'Model view', 'pause.exitTut': 'Exit tutorial',
      'over.eyebrow': 'Defeated', 'over.title': 'Verdigris falls', 'over.text': 'Score {s} · reached wave {w}',
      'tut.skip': 'Skip', 'tut.fly': 'Fly', 'tut.exit': 'Exit tutorial', 'tut.enter': 'or press Enter',
      'tut.invert': 'Invert climb / dive (pull back to climb, like a plane)',
      'tut.rollNow': 'Roll now!',
      'tut.done.eyebrow': 'Tutorial complete', 'tut.done.title': 'Fledged',
      'tut.done.text': 'You can steer, climb, boost, breathe fire, spit fireballs, roll out of danger and cook your own dinner. The crimson wyverns fly just like you, but they shoot back.',
      'tut.done.free': 'Keep practicing',
      'tut.step': 'Lesson {i} / {n}  ·  {title}',
      'tut.briefEye': 'Lesson {i} of {n}  ·  {grp}',
      'tut.free': 'Free practice',
      'tut.grp.basics': 'Flight basics', 'tut.grp.fire': 'Fire and food', 'tut.grp.final': 'Final test',
      'tut.roasted': 'Roasted!', 'tut.flyToEat': 'Fly into it to eat',
      'tut.crunch': 'Crunch!', 'tut.vit15': '+15 vitality',
      'tut.rawTip': 'Raw chicken! Roast it with fire first.',
      'tut.hitTip': 'Hit! Roll a little sooner, as the spark gets close.',
      'tut.dodged': 'Dodged!',
      'tut.wispTip': 'Here comes the wisp. Roll when you see "Roll now!"',
      'tut.moreChickens': 'Three more chickens took off.',
      'tut.wellDone': 'Well done', 'tut.next': 'Next: {t}', 'tut.complete': 'Tutorial complete',
      'mark.ring': 'Ring', 'mark.eat': 'Eat', 'mark.roasted': 'Roasted', 'mark.chicken': 'Chicken', 'mark.wisp': 'Wisp',
      'goal.rings': 'Fly through the rings  {a} / {b}',
      'goal.boost': 'Boost  {t} / {max} s  ·  Rings  {a} / {b}',
      'goal.roast': 'Roast the chicken  {p} %',
      'goal.eat': 'Eat the roast chicken',
      'goal.ball': 'Roasted  {a} / 2  ·  Eaten  {b} / 2',
      'goal.roll': 'Do a barrel roll  {a} / 2',
      'goal.dodge': 'Dodge sparks with a roll  {a} / 3',
      'goal.hunt': 'Chickens eaten  {a} / 3',
      'goal.free': 'Chickens eaten  {a}',
      'c.turn': 'Turn', 'c.steer': 'Steer', 'c.climbDive': 'Climb / dive', 'c.stick': 'Stick',
      'c.steerAll': 'Steer, climb and dive', 'c.holdBoost': 'Hold to boost', 'c.intoChicken': 'Steer into the chicken',

      'l.steer.title': 'Steering',
      'l.steer.text': 'Your dragon always flies forward on its own, so you only choose the direction. Steer through the golden rings. The first ring is straight ahead: just relax and let the dragon fly through it.',
      'l.steer.k1': 'Turn left / right (arrow keys work too)', 'l.steer.t1': 'Stick left / right', 'l.steer.t1d': 'Turn left / right',
      'l.climb.title': 'Climb and dive',
      'l.climb.text': 'Now the rings sit higher and lower. Climb for the high ones, dive for the low ones. You cannot crash: close to the ground the dragon pulls up by itself.',
      'l.climb.k1': 'Climb (nose up)', 'l.climb.k2': 'Dive (nose down)',
      'l.climb.t1': 'Stick up', 'l.climb.t1d': 'Climb', 'l.climb.t2': 'Stick down', 'l.climb.t2d': 'Dive', 'l.climb.t3': 'Stick sideways',
      'l.find.title': 'Finding your way',
      'l.find.text': 'Targets will not always be in front of you. When one is off-screen, a gold arrow on the edge of the screen points to it. The round radar shows the valley from above: you are the green triangle and the top of the radar is straight ahead. The first ring is behind you, so turn around.',
      'l.boost.title': 'Boost',
      'l.boost.text': 'Boost makes the dragon much faster. It burns the orange Fire bar at the top left, which refills by itself as soon as you let go. Boost for a few seconds and reach the two distant rings.',
      'l.breath.title': 'Fire breath',
      'l.breath.text': 'Dragons like their chicken roasted. Fly toward the chicken on the floating rock and breathe fire at it. The flame only reaches about 35 m, so get close. Keep it burning until the chicken turns golden brown. Flew past? Turn around and try again.',
      'l.breath.k1': 'Hold to breathe fire (or hold the left mouse button)', 'l.breath.t1': 'Breath', 'l.breath.t1d': 'Hold for a stream of fire',
      'l.dinner.title': 'Dinner time',
      'l.dinner.text': 'Roast ready. To eat, simply fly into the chicken and your dragon snaps it up. Eating refills the green Vitality bar.',
      'l.ball.title': 'Fireball',
      'l.ball.text': 'A fireball flies much further than breath and steers itself toward the target nearest the middle of your view, so point roughly at a chicken and fire. One hit roasts it. Each fireball costs some Fire, and you can spit one per second. Roast both chickens, then eat them.',
      'l.ball.k1': 'Fireball (or the right mouse button)', 'l.ball.t1': 'Ball', 'l.ball.t1d': 'Spit a fireball',
      'l.roll.title': 'Barrel roll',
      'l.roll.text': 'Q and E spin the dragon sideways in a quick barrel roll. While it spins, nothing can hit it. Do two rolls first. Then a practice wisp will shoot slow sparks at you: roll just before a spark reaches you. Practice sparks do not hurt.',
      'l.roll.k1': 'Roll left', 'l.roll.k2': 'Roll right', 'l.roll.t1': 'Roll', 'l.roll.t1d': 'Barrel roll (tilt the stick to pick the side)',
      'l.hunt.title': 'Chicken hunt',
      'l.hunt.text': 'Three chickens escaped and are flapping around the valley. Use everything you learned: find them with the arrows and radar, roast them with breath or fireballs, then catch and eat all three. A roasted chicken stops and hovers, waiting for you.',
      'l.hunt.boostD': 'Fly faster', 'l.hunt.breathD': 'Fire stream',

      /* campaign */
      'c.title': 'Verdigris Campaign',
      'c.desc': 'Raise a hatchling dragon: hunt to survive, grow and return to your volcano lair.',
      'c.loading': 'Warming the volcano',
      'c.engineFail': 'Could not load the 3D engine. Check your connection and reload.',
      'c.eyebrow': 'Campaign · alpha',
      'c.intro': 'Deep in a dormant volcano, the last Verdigris egg is about to hatch. Hunt to survive, grow strong and one day free the realm from the Order of the Iron Lance.',
      'c.start': 'Hatch',
      'c.back': 'Back to the duel',
      'c.wipNote': 'Early build - the world is still forming.',
      'c.wip': 'Flight test - hunting, hunger and the lair arrive in the next builds.',
      'c.stage.hatchling': 'Hatchling', 'c.stage.drake': 'Drake',
      'c.menu': 'Menu',
      'c.region.ash': 'Ash Wastes', 'c.region.wild': 'Wildwood',

      /* co-op */
      'mp.title': 'Verdigris Co-op',
      'mp.desc': 'Fly green dragons together against waves of crimson wyverns. Peer-to-peer co-op in the browser.',
      'mp.loading': 'Hatching the dragons',
      'mp.engineFail': 'Could not load the 3D engine. Check your connection and reload.',
      'mp.teamScore': 'Team score',
      'mp.room': 'Room', 'mp.copyInvite': 'Copy invite link', 'mp.menu': 'Menu',
      'mp.lobby.eyebrow': 'Co-op multiplayer · beta',
      'mp.lobby.text': 'Fly together against waves of crimson wyverns. Up to 6 dragons, connected directly browser to browser.',
      'mp.lobby.name': "Your dragon's name",
      'mp.lobby.host': 'Host a game', 'mp.lobby.or': 'or join a friend', 'mp.lobby.code': 'Room code', 'mp.lobby.join': 'Join',
      'mp.lobby.solo': 'Play solo instead',
      'mp.menu.title': 'Invite friends', 'mp.menu.text': 'The game keeps running while this menu is open.',
      'mp.menu.link': 'Invite link', 'mp.menu.copy': 'Copy', 'mp.leave': 'Leave game',
      'mp.over.eyebrow': 'The flight is lost', 'mp.over.title': 'All dragons down',
      'mp.over.text': 'Team score {s} · reached wave {w}', 'mp.over.wait': '. Waiting for the host to fly again.',
      'mp.notice.eyebrow': 'Disconnected', 'mp.notice.back': 'Back to lobby',
      'mp.hostLeft': 'The host left',
      'mp.hostLeftText': 'The game ended because the host closed their window or lost the connection.',
      'mp.lost': 'Connection lost',
      'mp.lostText': 'No word from the host for 15 seconds. They may have closed the game or lost their connection.',
      'mp.getReady': 'get ready', 'mp.startsIn': 'starts in {n} s',
      'mp.you': 'You', 'mp.aDragon': 'A dragon', 'mp.youTag': ' (you)', 'mp.downTag': 'down', 'mp.hp': '{n} hp',
      'mp.feed.youKill': 'You downed a wyvern  +{p}', 'mp.feed.kill': '{name} downed a wyvern  +{p}',
      'mp.feed.down': '{name} is down', 'mp.feed.join': '{name} joined the flight', 'mp.feed.left': '{name} left',
      'mp.feed.copied': 'Invite link copied', 'mp.feed.copyManual': 'Select the link and copy it',
      'mp.youDown': 'You are down', 'mp.backIn': 'Back in the air in {t} s',
      'mp.wave1in': 'Wave 1 in 5 s',
      'mp.solo': 'solo', 'mp.soloLink': 'Solo game - nobody can join',
      'mp.opening': 'Opening a room…',
      'mp.roomBanner': 'Room {c}', 'mp.sendLink': 'Send friends the link · wave 1 in 8 s',
      'mp.soloFlight': 'Solo flight', 'mp.noServerHost': "The matchmaking server couldn't be reached, so friends can't join this game",
      'mp.badCode': 'Room codes are 5 letters or digits, like K3X9Q.',
      'mp.noLib': "The multiplayer library didn't load. Check your connection and reload.",
      'mp.noLibSolo': "The multiplayer library didn't load, so only a solo flight is possible.",
      'mp.connecting': 'Connecting to room {c}…',
      'mp.unreachable': "Couldn't reach room {c}. Check the code. If it is right, one of you may be on a network that blocks direct connections (try mobile data).",
      'mp.joined': 'Joined room {c}', 'mp.flyTeam': 'Fly with your team',
      'mp.full': 'Room {c} is full (6 dragons).',
      'mp.hostClosed': 'The host closed the connection.',
      'mp.noRoom': 'No room with code {c}. Check the code with your host.',
      'mp.noServer': "Couldn't reach the matchmaking server. Try again in a moment.",
      'mp.failed': 'Connection failed ({t}). Try again.',
      'mp.unknown': 'unknown',
      'mp.invited': 'You are invited to room {c}. Pick a name and press Join.',
    },

    cs: {
      'lang.label': 'Jazyk',
      'install.btn': 'Nainstalovat aplikaci',
      'install.ios': 'Pro instalaci klepni na Sdílet a pak na Přidat na plochu.',
      'install.done': 'Nainstalováno. Hru teď spustíš z plochy.',
      'key.space': 'Mezerník',

      'hud.vitality': 'Vitalita',
      'hud.fire': 'Oheň',
      'hud.wave': 'Vlna',
      'hud.score': 'Skóre',
      'hud.pause': 'Pauza',
      'hud.foes': { one: '{n} wyverna', few: '{n} wyverny', other: '{n} wyveren' },
      'btn.roll': 'Výkrut', 'btn.ball': 'Koule', 'btn.boost': 'Turbo', 'btn.breath': 'Dech',
      'legend.turn': 'Zatáčení', 'legend.pitch': 'Stoupání / klesání', 'legend.breath': 'Ohnivý dech', 'legend.ball': 'Ohnivá koule',
      'legend.boost': 'Turbo', 'legend.roll': 'Výkrut', 'legend.pause': 'Pauza', 'legend.menu': 'Menu',
      'banner.wave': 'Vlna {n}',
      'banner.waveFoes': { one: '{n} karmínová wyverna', few: '{n} karmínové wyverny', other: '{n} karmínových wyveren' },
      'banner.cleared': 'Vlna {n} odražena',
      'banner.vit30': '+30 vitality',
      'btn.resume': 'Pokračovat',
      'btn.again': 'Letět znovu',

      'solo.title': 'Verdigris Sky Duel',
      'solo.desc': 'Ovládej procedurálního low-poly zeleného draka a utkej se s vlnami karmínových wyveren přímo v prohlížeči.',
      'solo.loading': 'Líhne se drak',
      'solo.engineFail': '3D engine se nepodařilo načíst',
      'intro.eyebrow': 'Procedurální 3D model',
      'intro.span': 'Rozpětí', 'intro.len': 'Délka', 'intro.mesh': 'Dílů',
      'intro.text': 'Zelený drak složený ze základních těles v Three.js. Tažením otáčíš pohledem, kolečkem myši nebo dvěma prsty přibližuješ.',
      'intro.learn': 'Nauč se létat', 'intro.replay': 'Zopakovat výcvik', 'intro.duel': 'Začít souboj',
      'intro.coop': 'Kooperativní multiplayer (beta)',
      'intro.campaign': 'Kampaň (alfa)',
      'intro.k.turn': 'Zatáčení a náklon', 'intro.k.pitch': 'Stoupání / klesání', 'intro.k.breath': 'Ohnivý dech (držet) nebo levé tlačítko myši',
      'intro.k.ball': 'Ohnivá koule se sama navádí, nebo pravé tlačítko myši', 'intro.k.boost': 'Turbo (spotřebovává oheň)', 'intro.k.roll': 'Výkrut, uhne před střelou',
      'intro.t.stick': 'Levá páčka', 'intro.t.stickD': 'Řízení, stoupání a klesání', 'intro.t.breath': 'Dech', 'intro.t.breathD': 'Držet pro proud ohně',
      'intro.t.ballroll': 'Koule / Výkrut', 'intro.t.ballrollD': 'Ohnivá koule, úhybný výkrut',
      'pause.eyebrow': 'Pozastaveno', 'pause.title': 'Křídla složena',
      'pause.restart': 'Opakovat lekci', 'pause.skip': 'Přeskočit lekci', 'pause.view': 'Pohled na model', 'pause.exitTut': 'Ukončit výcvik',
      'over.eyebrow': 'Poražen', 'over.title': 'Verdigris padá', 'over.text': 'Skóre {s} · dosažená vlna {w}',
      'tut.skip': 'Přeskočit', 'tut.fly': 'Letět', 'tut.exit': 'Ukončit výcvik', 'tut.enter': 'nebo stiskni Enter',
      'tut.invert': 'Obrátit stoupání / klesání (přitažením stoupáš, jako v letadle)',
      'tut.rollNow': 'Výkrut teď!',
      'tut.done.eyebrow': 'Výcvik dokončen', 'tut.done.title': 'Hotový letec',
      'tut.done.text': 'Umíš zatáčet, stoupat, zrychlit, chrlit oheň, plivat ohnivé koule, vykroutit se z nebezpečí a upéct si vlastní večeři. Karmínové wyverny létají stejně jako ty, ale střílejí zpátky.',
      'tut.done.free': 'Trénovat dál',
      'tut.step': 'Lekce {i} / {n}  ·  {title}',
      'tut.briefEye': 'Lekce {i} z {n}  ·  {grp}',
      'tut.free': 'Volný trénink',
      'tut.grp.basics': 'Základy letu', 'tut.grp.fire': 'Oheň a jídlo', 'tut.grp.final': 'Závěrečná zkouška',
      'tut.roasted': 'Opečeno!', 'tut.flyToEat': 'Vleť do něj a sněz ho',
      'tut.crunch': 'Křup!', 'tut.vit15': '+15 vitality',
      'tut.rawTip': 'Syrové kuře! Nejdřív ho opeč ohněm.',
      'tut.hitTip': 'Zásah! Až se jiskra blíží, udělej výkrut o chlup dřív.',
      'tut.dodged': 'Uhnuto!',
      'tut.wispTip': 'Přilétá bludička. Udělej výkrut, až uvidíš „Výkrut teď!“',
      'tut.moreChickens': 'Vzlétla další tři kuřata.',
      'tut.wellDone': 'Výborně', 'tut.next': 'Další: {t}', 'tut.complete': 'Výcvik dokončen',
      'mark.ring': 'Kruh', 'mark.eat': 'Sníst', 'mark.roasted': 'Opečené', 'mark.chicken': 'Kuře', 'mark.wisp': 'Bludička',
      'goal.rings': 'Proleť kruhy  {a} / {b}',
      'goal.boost': 'Turbo  {t} / {max} s  ·  Kruhy  {a} / {b}',
      'goal.roast': 'Opeč kuře  {p} %',
      'goal.eat': 'Sněz pečené kuře',
      'goal.ball': 'Opečeno  {a} / 2  ·  Snědeno  {b} / 2',
      'goal.roll': 'Udělej výkrut  {a} / 2',
      'goal.dodge': 'Uhni jiskrám výkrutem  {a} / 3',
      'goal.hunt': 'Snědená kuřata  {a} / 3',
      'goal.free': 'Snědená kuřata  {a}',
      'c.turn': 'Zatáčení', 'c.steer': 'Řízení', 'c.climbDive': 'Stoupání / klesání', 'c.stick': 'Páčka',
      'c.steerAll': 'Řízení, stoupání a klesání', 'c.holdBoost': 'Držet pro turbo', 'c.intoChicken': 'Naveď se přímo do kuřete',

      'l.steer.title': 'Řízení',
      'l.steer.text': 'Tvůj drak letí pořád sám dopředu, ty jen volíš směr. Proleť zlatými kruhy. První kruh je přímo před tebou: stačí se uvolnit a nechat draka, ať jím proletí.',
      'l.steer.k1': 'Zatočit vlevo / vpravo (fungují i šipky)', 'l.steer.t1': 'Páčka vlevo / vpravo', 'l.steer.t1d': 'Zatočit vlevo / vpravo',
      'l.climb.title': 'Stoupání a klesání',
      'l.climb.text': 'Teď jsou kruhy výš a níž. K vysokým vystoupej, k nízkým klesni. Nabourat nemůžeš: u země drak sám vytáhne nahoru.',
      'l.climb.k1': 'Stoupat (nos nahoru)', 'l.climb.k2': 'Klesat (nos dolů)',
      'l.climb.t1': 'Páčka nahoru', 'l.climb.t1d': 'Stoupat', 'l.climb.t2': 'Páčka dolů', 'l.climb.t2d': 'Klesat', 'l.climb.t3': 'Páčka do stran',
      'l.find.title': 'Orientace',
      'l.find.text': 'Cíle nebudou vždycky před tebou. Když je cíl mimo obrazovku, ukazuje na něj zlatá šipka na okraji. Kulatý radar ukazuje údolí shora: ty jsi zelený trojúhelník a horní okraj radaru je přímo před tebou. První kruh je za tebou, tak se otoč.',
      'l.boost.title': 'Turbo',
      'l.boost.text': 'Turbo draka výrazně zrychlí. Spaluje oranžový ukazatel Oheň vlevo nahoře, který se sám doplní, jakmile tlačítko pustíš. Drž turbo pár sekund a doleť ke dvěma vzdáleným kruhům.',
      'l.breath.title': 'Ohnivý dech',
      'l.breath.text': 'Draci mají kuře nejradši pečené. Leť ke kuřeti na létající skále a dýchni na něj oheň. Plamen dosáhne jen asi 35 m, tak se přibliž. Pal, dokud kuře nezezlátne. Přeletěl jsi ho? Otoč se a zkus to znovu.',
      'l.breath.k1': 'Držet pro ohnivý dech (nebo držet levé tlačítko myši)', 'l.breath.t1': 'Dech', 'l.breath.t1d': 'Držet pro proud ohně',
      'l.dinner.title': 'Čas na večeři',
      'l.dinner.text': 'Pečeně je hotová. Stačí do kuřete vletět a drak ho chňapne. Jídlo doplní zelený ukazatel Vitalita.',
      'l.ball.title': 'Ohnivá koule',
      'l.ball.text': 'Ohnivá koule doletí mnohem dál než dech a sama se navede na cíl nejblíž středu výhledu, takže stačí zhruba mířit na kuře a vystřelit. Jeden zásah ho upeče. Každá koule stojí trochu ohně a vystřelit můžeš jednu za sekundu. Upeč obě kuřata a pak je sněz.',
      'l.ball.k1': 'Ohnivá koule (nebo pravé tlačítko myši)', 'l.ball.t1': 'Koule', 'l.ball.t1d': 'Vyplivnout ohnivou kouli',
      'l.roll.title': 'Výkrut',
      'l.roll.text': 'Klávesy Q a E draka bleskově roztočí do strany. Během výkrutu ho nic nezasáhne. Nejdřív udělej dva výkruty. Pak na tebe začne cvičná bludička střílet pomalé jiskry: udělej výkrut těsně předtím, než tě jiskra trefí. Cvičné jiskry nebolí.',
      'l.roll.k1': 'Výkrut vlevo', 'l.roll.k2': 'Výkrut vpravo', 'l.roll.t1': 'Výkrut', 'l.roll.t1d': 'Výkrut (náklonem páčky zvolíš stranu)',
      'l.hunt.title': 'Hon na kuřata',
      'l.hunt.text': 'Tři kuřata utekla a poletují po údolí. Využij všechno, co ses naučil: najdi je pomocí šipek a radaru, upeč je dechem nebo ohnivými koulemi, pak je chyť a sněz všechna tři. Upečené kuře se zastaví a čeká na tebe ve vzduchu.',
      'l.hunt.boostD': 'Rychlejší let', 'l.hunt.breathD': 'Proud ohně',

      'c.title': 'Verdigris - kampaň',
      'c.desc': 'Vychovej dračí mládě: lov, abys přežil, sílej a vracej se do sopečného doupěte.',
      'c.loading': 'Sopka se probouzí',
      'c.engineFail': '3D engine se nepodařilo načíst. Zkontroluj připojení a obnov stránku.',
      'c.eyebrow': 'Kampaň · alfa',
      'c.intro': 'Hluboko v dřímající sopce se líhne poslední vejce rodu Verdigris. Lov, abys přežil, sílej a jednou osvoboď říši od Řádu železného kopí.',
      'c.start': 'Vylíhnout',
      'c.back': 'Zpět na souboj',
      'c.wipNote': 'Rozpracovaná verze - svět se teprve tvoří.',
      'c.wip': 'Zkušební let - lov, hlad a doupě přijdou v dalších verzích.',
      'c.stage.hatchling': 'Mládě', 'c.stage.drake': 'Drak',
      'c.menu': 'Menu',
      'c.region.ash': 'Popelavé pustiny', 'c.region.wild': 'Divoký hvozd',

      'mp.title': 'Verdigris Co-op',
      'mp.desc': 'Leťte společně se zelenými draky proti vlnám karmínových wyveren. Kooperace v prohlížeči, spojení peer-to-peer.',
      'mp.loading': 'Líhnou se draci',
      'mp.engineFail': '3D engine se nepodařilo načíst. Zkontroluj připojení a obnov stránku.',
      'mp.teamScore': 'Týmové skóre',
      'mp.room': 'Místnost', 'mp.copyInvite': 'Zkopírovat odkaz s pozvánkou', 'mp.menu': 'Menu',
      'mp.lobby.eyebrow': 'Kooperativní multiplayer · beta',
      'mp.lobby.text': 'Leťte společně proti vlnám karmínových wyveren. Až 6 draků propojených přímo z prohlížeče do prohlížeče.',
      'mp.lobby.name': 'Jméno tvého draka',
      'mp.lobby.host': 'Založit hru', 'mp.lobby.or': 'nebo se přidej ke kamarádovi', 'mp.lobby.code': 'Kód místnosti', 'mp.lobby.join': 'Připojit',
      'mp.lobby.solo': 'Hrát raději sólo',
      'mp.menu.title': 'Pozvi kamarády', 'mp.menu.text': 'Hra běží dál, i když je toto menu otevřené.',
      'mp.menu.link': 'Odkaz s pozvánkou', 'mp.menu.copy': 'Kopírovat', 'mp.leave': 'Opustit hru',
      'mp.over.eyebrow': 'Let je ztracen', 'mp.over.title': 'Všichni draci padli',
      'mp.over.text': 'Týmové skóre {s} · dosažená vlna {w}', 'mp.over.wait': '. Čeká se, až hostitel spustí další let.',
      'mp.notice.eyebrow': 'Odpojeno', 'mp.notice.back': 'Zpět do lobby',
      'mp.hostLeft': 'Hostitel odešel',
      'mp.hostLeftText': 'Hra skončila, protože hostitel zavřel okno nebo ztratil připojení.',
      'mp.lost': 'Spojení ztraceno',
      'mp.lostText': 'Hostitel se 15 sekund neozval. Možná zavřel hru nebo ztratil připojení.',
      'mp.getReady': 'připrav se', 'mp.startsIn': 'začíná za {n} s',
      'mp.you': 'Ty', 'mp.aDragon': 'Neznámý drak', 'mp.youTag': ' (ty)', 'mp.downTag': 'sestřelen', 'mp.hp': '{n} HP',
      'mp.feed.youKill': 'Sestřelil jsi wyvernu  +{p}', 'mp.feed.kill': '{name} sestřelil wyvernu  +{p}',
      'mp.feed.down': '{name} je sestřelen', 'mp.feed.join': '{name} se přidal k letu', 'mp.feed.left': '{name} odešel',
      'mp.feed.copied': 'Odkaz s pozvánkou zkopírován', 'mp.feed.copyManual': 'Označ odkaz a zkopíruj ho',
      'mp.youDown': 'Jsi sestřelen', 'mp.backIn': 'Zpět ve vzduchu za {t} s',
      'mp.wave1in': 'Vlna 1 za 5 s',
      'mp.solo': 'sólo', 'mp.soloLink': 'Sólo hra - nikdo se nemůže připojit',
      'mp.opening': 'Otevírám místnost…',
      'mp.roomBanner': 'Místnost {c}', 'mp.sendLink': 'Pošli kamarádům odkaz · vlna 1 za 8 s',
      'mp.soloFlight': 'Sólo let', 'mp.noServerHost': 'Server pro párování hráčů je nedostupný, kamarádi se k této hře nepřipojí',
      'mp.badCode': 'Kód místnosti má 5 písmen nebo číslic, třeba K3X9Q.',
      'mp.noLib': 'Knihovna pro multiplayer se nenačetla. Zkontroluj připojení a obnov stránku.',
      'mp.noLibSolo': 'Knihovna pro multiplayer se nenačetla, takže je možný jen sólo let.',
      'mp.connecting': 'Připojuji se k místnosti {c}…',
      'mp.unreachable': 'Místnost {c} je nedostupná. Zkontroluj kód. Pokud je správný, někdo z vás může být v síti, která blokuje přímá spojení (zkus mobilní data).',
      'mp.joined': 'Připojeno k místnosti {c}', 'mp.flyTeam': 'Leť se svým týmem',
      'mp.full': 'Místnost {c} je plná (6 draků).',
      'mp.hostClosed': 'Hostitel ukončil spojení.',
      'mp.noRoom': 'Místnost s kódem {c} neexistuje. Ověř si kód u hostitele.',
      'mp.noServer': 'Server pro párování hráčů je nedostupný. Zkus to za chvíli znovu.',
      'mp.failed': 'Připojení selhalo ({t}). Zkus to znovu.',
      'mp.unknown': 'neznámá chyba',
      'mp.invited': 'Máš pozvánku do místnosti {c}. Zvol jméno a stiskni Připojit.',
    },
  };

  const codes = LANGS.map(l => l.code);
  function store(v) { try { if (v === undefined) return localStorage.getItem(STORE_KEY); localStorage.setItem(STORE_KEY, v); } catch (_) { return null; } }
  function detect() {
    const q = (location.search.match(/[?&]lang=([a-z]{2})/) || [])[1];
    if (q && codes.includes(q)) return q;
    const s = store();
    if (s && codes.includes(s)) return s;
    const prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (const p of prefs) {
      const c = String(p).toLowerCase().slice(0, 2);
      if (c === 'sk' && codes.includes('cs')) return 'cs'; // Slovak readers understand Czech better than English, on average
      if (codes.includes(c)) return c;
    }
    return 'en';
  }

  let lang = detect();
  let plural = new Intl.PluralRules(lang);
  const listeners = [];

  function t(key, params) {
    let v = DICT[lang][key];
    if (v == null) v = DICT.en[key];
    if (v == null) return key;
    if (typeof v === 'object') {
      const n = params && params.n != null ? params.n : 0;
      v = v[plural.select(n)] || v.other;
    }
    if (params) v = v.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
    return v;
  }
  function num(x, digits) {
    try { return Number(x).toLocaleString(lang, { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 }); }
    catch (_) { return Number(x).toFixed(digits || 0); }
  }
  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-attr]').forEach(el => {
      el.dataset.i18nAttr.split(';').forEach(pair => {
        const [attr, key] = pair.split(':').map(s => s.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      });
    });
    document.documentElement.lang = lang;
    renderSwitchers();
  }
  function renderSwitchers() {
    document.querySelectorAll('.langSwitch').forEach(box => {
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', t('lang.label'));
      if (!box.children.length) {
        LANGS.forEach(l => {
          const b = document.createElement('button');
          b.type = 'button'; b.textContent = l.label; b.title = l.name; b.lang = l.code; b.dataset.lang = l.code;
          b.addEventListener('click', () => setLang(l.code));
          box.appendChild(b);
        });
      }
      box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    });
  }
  function setLang(code) {
    if (!codes.includes(code) || code === lang) return;
    lang = code; plural = new Intl.PluralRules(lang);
    store(code);
    apply();
    listeners.forEach(fn => { try { fn(lang); } catch (e) { console.error(e); } });
  }
  function onChange(fn) { listeners.push(fn); }

  window.I18N = { t, num, apply, setLang, onChange, LANGS, get lang() { return lang; } };
  document.documentElement.lang = lang;
  // Load this script at the end of <body> (before the game scripts) so static text is swapped before first paint.
  if (document.body) apply();
  else document.addEventListener('DOMContentLoaded', () => apply());
})();
