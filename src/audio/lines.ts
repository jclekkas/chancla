// Every spoken line: Spanish delivery (what is voiced), English and
// Spanish subtitles, who says it, and how it is scheduled. Lines are
// original writing for this game.
//
//   cat 'story'     mission narrative and objective calls; always plays
//                   (subtitled) even with automatic banter off
//   cat 'banter'    automatic reactions; muted by the "banter" setting
//   pri             1 low .. 3 high; higher preempts lower, never the reverse

export type Speaker = 'rosa' | 'influ' | 'bocinas' | 'soplador' | 'cart' | 'rollcart' | 'pinata' | 'vecina';

export interface Line { id: string; who: Speaker; es: string; en: string; cat: 'story' | 'banter'; pri: 1 | 2 | 3 }

const L = (id: string, who: Speaker, es: string, en: string, cat: 'story' | 'banter' = 'banter', pri: 1 | 2 | 3 = 1): Line => ({ id, who, es, en, cat, pri });

export const LINES: Line[] = [
  // ---- Shared Rosa reactions (campaign and multiplayer) -------------------
  L('miss1', 'rosa', 'Era de advertencia.', 'That was a warning shot.'),
  L('miss2', 'rosa', 'Era para ver si estabas prestando atención.', 'Just checking you were paying attention.'),
  L('miss3', 'rosa', 'El viento. Fue el viento.', 'The wind. It was the wind.'),
  L('miss4', 'rosa', 'Esa iba con cariño.', 'That one was thrown with love.'),
  L('ricochet1', 'rosa', 'Hasta las paredes me hacen caso.', 'Even the walls do as I say.'),
  L('ricochet2', 'rosa', 'Rebote de profesional.', 'A professional bounce.'),
  L('ricochet3', 'rosa', 'Por la banda. Como debe ser.', 'Off the cushion. As it should be.'),
  L('elim1', 'rosa', 'Entrega a domicilio.', 'Home delivery.'),
  L('elim2', 'rosa', 'Y no me hagas repetirlo.', "And don't make me say it twice."),
  L('elim3', 'rosa', 'Siguiente.', 'Next.'),
  L('elim4', 'rosa', 'Eso te pasa por contestar.', "That's what you get for talking back."),
  L('hurt1', 'rosa', '¡Ay! ¿Quién fue?', 'Ow! Who did that?'),
  L('hurt2', 'rosa', 'Eso me lo vas a pagar.', "You're going to pay for that."),
  L('hurt3', 'rosa', 'Mi peinado no.', 'Not the hair.'),
  L('rulero1', 'rosa', '¡Con los ruleros no!', 'Not the rollers!'),
  L('low1', 'rosa', 'Necesito un cafecito. Urgente.', 'I need a cafecito. Urgently.'),
  L('respawn1', 'rosa', 'Ya volví. Y traje la otra.', "I'm back. And I brought the other one."),
  L('respawn2', 'rosa', '¿Me extrañaron?', 'Did you miss me?'),
  L('respawn3', 'rosa', 'Segundo round.', 'Round two.'),
  L('start1', 'rosa', 'Se acabó la tontería.', "That's enough nonsense.", 'story', 2),
  L('start2', 'rosa', 'A ver quién manda en este patio.', "Let's see who runs this patio.", 'story', 2),
  L('win1', 'rosa', 'Ahora sí, ¿quién quiere cafecito?', 'Now then, who wants a cafecito?', 'story', 3),
  L('win2', 'rosa', 'Y así se hace.', "And that's how it's done.", 'story', 3),
  L('lose1', 'rosa', 'Mañana sigo. Y no les va a gustar.', "I'll be back tomorrow. You won't like it.", 'story', 3),
  L('lose2', 'rosa', 'Hoy les dejé ganar. Por educación.', 'I let you win today. Out of politeness.', 'story', 3),
  L('cafecito', 'rosa', 'Ay, qué rico.', 'Oh, that hits the spot.'),
  L('ko1', 'rosa', 'Me tropecé. Nada más.', 'I tripped. That is all.', 'story', 2),
  L('heavy_hint', 'rosa', 'Esto necesita La Pesada.', 'This needs La Pesada.', 'story', 2),
  L('bank_hint', 'rosa', 'Así no. Por la pared, con estilo.', 'Not like that. Off the wall, with style.', 'story', 2),
  L('timing_hint', 'rosa', 'Espera el verde. Paciencia.', 'Wait for the green. Patience.', 'story', 2),
  L('checkpoint1', 'rosa', 'Bueno. Vamos por partes.', 'Right. One thing at a time.'),

  // ---- Mission 1: Operación Ruleros --------------------------------------
  L('m1_start', 'rosa', 'Sin mis ruleros, esta reunión se cancela.', 'Without my rollers, this party is cancelled.', 'story', 3),
  L('m1_first', 'rosa', 'Uno menos. Cinco culpables.', 'One down. Five guilty parties.', 'story', 2),
  L('m1_courtyard', 'rosa', 'Los demás andan sueltos por el patio.', 'The rest are loose out in the courtyard.', 'story', 2),
  L('m1_latch', 'rosa', '¿En la canasta? ¿Quién los subió hasta allá?', 'In the basket? Who put them up there?', 'story', 2),
  L('m1_bank', 'rosa', 'Hasta la pared sabe dónde van mis cosas.', 'Even the wall knows where my things go.', 'story', 2),
  L('m1_tower', 'rosa', 'Cajas vacías. Siempre las cajas vacías.', 'Empty boxes. Always the empty boxes.', 'story', 2),
  L('m1_poser', 'rosa', 'Qué bonita foto. Ahora devuélvemelos.', 'Lovely photo. Now give them back.', 'story', 2),
  L('m1_cart', 'rosa', '¿Y ese carrito? ¡Lleva mis últimos ruleros!', "And that little cart? It's got my last rollers!", 'story', 3),
  L('m1_final', 'rosa', 'Ahora sí. Belleza bajo presión.', 'There we go. Beauty under pressure.', 'story', 3),

  // ---- Mission 2: Aquí se cocina, no se improvisa --------------------------
  L('m2_start', 'rosa', 'La receta dice una pizca. ¡Una!', 'The recipe says a pinch. One!', 'story', 3),
  L('m2_baskets', 'rosa', 'Las canastas, ¿quién las escondió en el mercado?', 'The baskets. Who hid them in the market?', 'story', 2),
  L('m2_cook', 'rosa', 'Nadie toca la olla. Nadie.', 'Nobody touches the pot. Nobody.', 'story', 2),
  L('m2_influ', 'rosa', 'Primero se cocina. Después se publica.', 'First we cook. Then you post.', 'story', 2),
  L('m2_recover', 'rosa', 'Aquí nada se desperdicia. Ni el chanclazo.', 'Nothing goes to waste here. Not even a chancla.', 'story', 2),
  L('m2_tray', 'rosa', 'La charola va al patio. Sin escalas.', 'The tray goes to the courtyard. No stopovers.', 'story', 2),
  L('m2_spill', 'rosa', '¡Mi charola! Bueno. Se levanta y se sigue.', 'My tray! Fine. Pick it up and keep going.', 'story', 2),
  L('m2_done', 'rosa', 'Está servido. Y no quiero comentarios del chef de internet.', 'Dinner is served. And no notes from the internet chef.', 'story', 3),
  L('timer_haywire', 'rosa', '¿Y ahora el reloj? Ese reloj tiene más drama que mi comadre.', 'Now the timer? That timer has more drama than my comadre.', 'story', 2),
  L('m2_segment', 'rosa', 'Vamos bien. No lo arruinen.', "We're doing well. Don't ruin it."),
  L('m2_setback', 'rosa', 'Se enfrió. Otra vez desde el principio de este paso.', 'It went cold. This step again from the top.', 'story', 2),

  // ---- Mission 3: Este patio no se limpia solo ------------------------------
  L('m3_start', 'rosa', 'Qué curioso. Para comer estaban todos.', 'Funny. Everybody showed up to eat.', 'story', 3),
  L('m3_switch', 'rosa', 'Al bote. Todo al bote.', 'In the bin. All of it.'),
  L('m3_blower', 'rosa', '¡Eso mueve la mugre, no la limpia!', "That moves the dirt, it doesn't clean it!", 'story', 2),
  L('m3_bank', 'rosa', 'Limpieza profunda.', 'Deep cleaning.', 'story', 2),
  L('m3_scatter', 'rosa', '¡Lo acababa de recoger!', 'I just picked that up!', 'story', 2),
  L('m3_blower_off', 'rosa', 'Esto queda confiscado.', 'This is confiscated.', 'story', 3),
  L('m3_zone', 'rosa', 'Una zona menos. Ya casi parece casa decente.', "One area done. It almost looks like a decent home.", 'story', 2),
  L('m3_chairs', 'rosa', 'Las sillas no se guardan solas, ¿verdad?', "The chairs won't put themselves away, will they?"),
  L('m3_done', 'rosa', 'Ahora sí parece fiesta y no evidencia.', 'Now it looks like a party and not a crime scene.', 'story', 3),

  // ---- Mission 4: La Piñata Contraataca --------------------------------------
  L('m4_start', 'rosa', '¿Quién compró la piñata con modo defensa?', 'Who bought the piñata with a defense mode?', 'story', 3),
  L('m4_phase2', 'rosa', 'Ah, ¿también tienes carácter?', 'Oh, so you have an attitude too?', 'story', 3),
  L('m4_phase3', 'rosa', 'Ya te vi el corazón. Quédate quieta.', 'I can see your heart. Hold still.', 'story', 3),
  L('pinata_tip', 'rosa', 'Una puntita menos.', 'One point fewer.'),
  L('pinata_decoys', 'rosa', '¿Piñatitas? ¿En serio?', 'Mini piñatas? Seriously?', 'story', 2),
  L('pinata_decoys2', 'rosa', 'Traen refuerzos. Yo también: la otra chancla.', "They brought backup. So did I: the other chancla.", 'story', 2),
  L('m4_final', 'rosa', 'Se acabó la fiesta. Bueno… ahora empieza.', 'The party is over. Well… now it starts.', 'story', 3),

  // ---- Opponents: a smaller, distinct set ---------------------------------
  L('influ_hit', 'influ', '¡Oye! ¡Estaba en vivo!', 'Hey! I was live!', 'banter', 2),
  L('influ_hit2', 'influ', '¡Eso no va en mi contenido!', "That's not going in my content!", 'banter', 2),
  L('influ_dodge', 'influ', 'Sin spoilers, señora.', 'No spoilers, ma’am.'),
  L('bocinas_warn', 'bocinas', '¡Súbele, súbele!', 'Turn it up, turn it up!', 'banter', 2),
  L('bocinas_hit', 'bocinas', '¡Mi bocina! ¡Es nueva!', 'My speaker! It’s brand new!', 'banter', 2),
  L('soplador_warn', 'soplador', 'Aguas, que ahí va el aire.', 'Heads up, here comes the air.', 'banter', 2),
  L('soplador_hit', 'soplador', '¡Oiga, que estoy trabajando!', "Hey, lady, I'm working here!", 'banter', 2),
  L('cart_hit', 'cart', 'Entrega en proceso. Entrega en proceso.', 'Delivery in progress. Delivery in progress.', 'banter', 2),
  L('rollcart_hit', 'rollcart', '¡Bip! Perdón. ¡Bip!', 'Beep! Sorry. Beep!'),
  L('pinata_intro', 'pinata', 'Sistema de fiesta premium activado. Modo defensa: encendido.', 'Premium party system activated. Defense mode: on.', 'story', 3),
  L('pinata_phase2', 'pinata', 'Error de diversión. Desplegando piñatas auxiliares.', 'Fun error. Deploying auxiliary piñatas.', 'story', 2),
  L('pinata_phase3', 'pinata', 'Advertencia. Núcleo de dulces expuesto.', 'Warning. Candy core exposed.', 'story', 2),
  L('pinata_hit', 'pinata', 'Daño estético detectado.', 'Cosmetic damage detected.'),
];

export const LINE_BY_ID = new Map(LINES.map((l) => [l.id, l]));

// Pools for event-driven reactions; one is picked at random, avoiding repeats.
export const POOLS: Record<string, string[]> = {
  miss: ['miss1', 'miss2', 'miss3', 'miss4'],
  ricochet: ['ricochet1', 'ricochet2', 'ricochet3'],
  elim: ['elim1', 'elim2', 'elim3', 'elim4'],
  hurt: ['hurt1', 'hurt2', 'hurt3'],
  // A roller knocked off your head by El Revés (occasional, rate-limited).
  rulero: ['rulero1', 'hurt3'],
  low: ['low1'],
  respawn: ['respawn1', 'respawn2', 'respawn3'],
  start: ['start1', 'start2'],
  win: ['win1', 'win2'],
  lose: ['lose1', 'lose2'],
  influ_hit: ['influ_hit', 'influ_hit2'],
};

// Minimum time between two lines from the same pool, ms.
export const POOL_COOLDOWN: Record<string, number> = {
  miss: 14000, ricochet: 8000, elim: 6000, hurt: 9000, rulero: 15000, low: 20000, respawn: 4000, influ_hit: 5000,
};
