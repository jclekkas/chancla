# Voice recording script

Every spoken line in the game. Delivery is Spanish; the English column is the subtitle, not a line to record.

The current files in `public/voice/` are **temporary synthetic placeholders** (SVOX Pico and eSpeak NG), not performances. To replace them, record each line and export it as `public/voice/<id>.mp3`. A mono MP3 (or any format all target browsers decode) at -18 LUFS, trimmed tight, works. Then update its `ms` in `public/voice/manifest.json`, or rerun the measuring step in `scripts/make-voices.ts`, and set `quality` to `recorded`. The game reads clip lengths from the manifest, so subtitles stay in sync.

Direction: Rosa is warm, quick and theatrical. She is never shrill and never a caricature. Her timing is dry; she has seen it all. The opponents are broad and comic. The party system is a cheerful, malfunctioning robot announcer. Do not imitate any real performer.

## Doña Rosa (67)

| File | Spanish (record this) | English subtitle | Plays |
| --- | --- | --- | --- |
| `miss1.mp3` | Era de advertencia. | That was a warning shot. | reaction: miss |
| `miss2.mp3` | Era para ver si estabas prestando atención. | Just checking you were paying attention. | reaction: miss |
| `miss3.mp3` | El viento. Fue el viento. | The wind. It was the wind. | reaction: miss |
| `miss4.mp3` | Esa iba con cariño. | That one was thrown with love. | reaction: miss |
| `ricochet1.mp3` | Hasta las paredes me hacen caso. | Even the walls do as I say. | reaction: ricochet |
| `ricochet2.mp3` | Rebote de profesional. | A professional bounce. | reaction: ricochet |
| `ricochet3.mp3` | Por la banda. Como debe ser. | Off the cushion. As it should be. | reaction: ricochet |
| `elim1.mp3` | Entrega a domicilio. | Home delivery. | reaction: elim |
| `elim2.mp3` | Y no me hagas repetirlo. | And don't make me say it twice. | reaction: elim |
| `elim3.mp3` | Siguiente. | Next. | reaction: elim |
| `elim4.mp3` | Eso te pasa por contestar. | That's what you get for talking back. | reaction: elim |
| `hurt1.mp3` | ¡Ay! ¿Quién fue? | Ow! Who did that? | reaction: hurt |
| `hurt2.mp3` | Eso me lo vas a pagar. | You're going to pay for that. | reaction: hurt |
| `hurt3.mp3` | Mi peinado no. | Not the hair. | reaction: hurt, rulero |
| `rulero1.mp3` | ¡Con los ruleros no! | Not the rollers! | reaction: rulero |
| `low1.mp3` | Necesito un cafecito. Urgente. | I need a cafecito. Urgently. | reaction: low |
| `respawn1.mp3` | Ya volví. Y traje la otra. | I'm back. And I brought the other one. | reaction: respawn |
| `respawn2.mp3` | ¿Me extrañaron? | Did you miss me? | reaction: respawn |
| `respawn3.mp3` | Segundo round. | Round two. | reaction: respawn |
| `start1.mp3` | Se acabó la tontería. | That's enough nonsense. | reaction: start |
| `start2.mp3` | A ver quién manda en este patio. | Let's see who runs this patio. | reaction: start |
| `win1.mp3` | Ahora sí, ¿quién quiere cafecito? | Now then, who wants a cafecito? | reaction: win |
| `win2.mp3` | Y así se hace. | And that's how it's done. | reaction: win |
| `lose1.mp3` | Mañana sigo. Y no les va a gustar. | I'll be back tomorrow. You won't like it. | reaction: lose |
| `lose2.mp3` | Hoy les dejé ganar. Por educación. | I let you win today. Out of politeness. | reaction: lose |
| `cafecito.mp3` | Ay, qué rico. | Oh, that hits the spot. | event |
| `ko1.mp3` | Me tropecé. Nada más. | I tripped. That is all. | scripted |
| `heavy_hint.mp3` | Esto necesita La Pesada. | This needs La Pesada. | scripted |
| `bank_hint.mp3` | Así no. Por la pared, con estilo. | Not like that. Off the wall, with style. | scripted |
| `timing_hint.mp3` | Espera el verde. Paciencia. | Wait for the green. Patience. | scripted |
| `checkpoint1.mp3` | Bueno. Vamos por partes. | Right. One thing at a time. | event |
| `m1_start.mp3` | Sin mis ruleros, esta reunión se cancela. | Without my rollers, this party is cancelled. | scripted |
| `m1_first.mp3` | Uno menos. Cinco culpables. | One down. Five guilty parties. | scripted |
| `m1_courtyard.mp3` | Los demás andan sueltos por el patio. | The rest are loose out in the courtyard. | scripted |
| `m1_latch.mp3` | ¿En la canasta? ¿Quién los subió hasta allá? | In the basket? Who put them up there? | scripted |
| `m1_bank.mp3` | Hasta la pared sabe dónde van mis cosas. | Even the wall knows where my things go. | scripted |
| `m1_tower.mp3` | Cajas vacías. Siempre las cajas vacías. | Empty boxes. Always the empty boxes. | scripted |
| `m1_poser.mp3` | Qué bonita foto. Ahora devuélvemelos. | Lovely photo. Now give them back. | scripted |
| `m1_cart.mp3` | ¿Y ese carrito? ¡Lleva mis últimos ruleros! | And that little cart? It's got my last rollers! | scripted |
| `m1_final.mp3` | Ahora sí. Belleza bajo presión. | There we go. Beauty under pressure. | scripted |
| `m2_start.mp3` | La receta dice una pizca. ¡Una! | The recipe says a pinch. One! | scripted |
| `m2_baskets.mp3` | Las canastas, ¿quién las escondió en el mercado? | The baskets. Who hid them in the market? | scripted |
| `m2_cook.mp3` | Nadie toca la olla. Nadie. | Nobody touches the pot. Nobody. | scripted |
| `m2_influ.mp3` | Primero se cocina. Después se publica. | First we cook. Then you post. | scripted |
| `m2_recover.mp3` | Aquí nada se desperdicia. Ni el chanclazo. | Nothing goes to waste here. Not even a chancla. | scripted |
| `m2_tray.mp3` | La charola va al patio. Sin escalas. | The tray goes to the courtyard. No stopovers. | scripted |
| `m2_spill.mp3` | ¡Mi charola! Bueno. Se levanta y se sigue. | My tray! Fine. Pick it up and keep going. | scripted |
| `m2_done.mp3` | Está servido. Y no quiero comentarios del chef de internet. | Dinner is served. And no notes from the internet chef. | scripted |
| `timer_haywire.mp3` | ¿Y ahora el reloj? Ese reloj tiene más drama que mi comadre. | Now the timer? That timer has more drama than my comadre. | scripted |
| `m2_segment.mp3` | Vamos bien. No lo arruinen. | We're doing well. Don't ruin it. | event |
| `m2_setback.mp3` | Se enfrió. Otra vez desde el principio de este paso. | It went cold. This step again from the top. | scripted |
| `m3_start.mp3` | Qué curioso. Para comer estaban todos. | Funny. Everybody showed up to eat. | scripted |
| `m3_switch.mp3` | Al bote. Todo al bote. | In the bin. All of it. | event |
| `m3_blower.mp3` | ¡Eso mueve la mugre, no la limpia! | That moves the dirt, it doesn't clean it! | scripted |
| `m3_bank.mp3` | Limpieza profunda. | Deep cleaning. | scripted |
| `m3_scatter.mp3` | ¡Lo acababa de recoger! | I just picked that up! | scripted |
| `m3_blower_off.mp3` | Esto queda confiscado. | This is confiscated. | scripted |
| `m3_zone.mp3` | Una zona menos. Ya casi parece casa decente. | One area done. It almost looks like a decent home. | scripted |
| `m3_chairs.mp3` | Las sillas no se guardan solas, ¿verdad? | The chairs won't put themselves away, will they? | event |
| `m3_done.mp3` | Ahora sí parece fiesta y no evidencia. | Now it looks like a party and not a crime scene. | scripted |
| `m4_start.mp3` | ¿Quién compró la piñata con modo defensa? | Who bought the piñata with a defense mode? | scripted |
| `m4_phase2.mp3` | Ah, ¿también tienes carácter? | Oh, so you have an attitude too? | scripted |
| `m4_phase3.mp3` | Ya te vi el corazón. Quédate quieta. | I can see your heart. Hold still. | scripted |
| `pinata_tip.mp3` | Una puntita menos. | One point fewer. | event |
| `pinata_decoys.mp3` | ¿Piñatitas? ¿En serio? | Mini piñatas? Seriously? | scripted |
| `pinata_decoys2.mp3` | Traen refuerzos. Yo también: la otra chancla. | They brought backup. So did I: the other chancla. | scripted |
| `m4_final.mp3` | Se acabó la fiesta. Bueno… ahora empieza. | The party is over. Well… now it starts. | scripted |

## El Influencer (3)

| File | Spanish (record this) | English subtitle | Plays |
| --- | --- | --- | --- |
| `influ_hit.mp3` | ¡Oye! ¡Estaba en vivo! | Hey! I was live! | reaction: influ_hit |
| `influ_hit2.mp3` | ¡Eso no va en mi contenido! | That's not going in my content! | reaction: influ_hit |
| `influ_dodge.mp3` | Sin spoilers, señora. | No spoilers, ma’am. | event |

## El Bocinas (2)

| File | Spanish (record this) | English subtitle | Plays |
| --- | --- | --- | --- |
| `bocinas_warn.mp3` | ¡Súbele, súbele! | Turn it up, turn it up! | event |
| `bocinas_hit.mp3` | ¡Mi bocina! ¡Es nueva! | My speaker! It’s brand new! | event |

## El Soplador (2)

| File | Spanish (record this) | English subtitle | Plays |
| --- | --- | --- | --- |
| `soplador_warn.mp3` | Aguas, que ahí va el aire. | Heads up, here comes the air. | event |
| `soplador_hit.mp3` | ¡Oiga, que estoy trabajando! | Hey, lady, I'm working here! | event |

## Express 3000 (wind-up toy cart) (1)

| File | Spanish (record this) | English subtitle | Plays |
| --- | --- | --- | --- |
| `cart_hit.mp3` | Entrega en proceso. Entrega en proceso. | Delivery in progress. Delivery in progress. | event |

## Serving trolley (1)

| File | Spanish (record this) | English subtitle | Plays |
| --- | --- | --- | --- |
| `rollcart_hit.mp3` | ¡Bip! Perdón. ¡Bip! | Beep! Sorry. Beep! | event |

## Premium party system (robot announcer) (4)

| File | Spanish (record this) | English subtitle | Plays |
| --- | --- | --- | --- |
| `pinata_intro.mp3` | Sistema de fiesta premium activado. Modo defensa: encendido. | Premium party system activated. Defense mode: on. | scripted |
| `pinata_phase2.mp3` | Error de diversión. Desplegando piñatas auxiliares. | Fun error. Deploying auxiliary piñatas. | scripted |
| `pinata_phase3.mp3` | Advertencia. Núcleo de dulces expuesto. | Warning. Candy core exposed. | scripted |
| `pinata_hit.mp3` | Daño estético detectado. | Cosmetic damage detected. | event |
