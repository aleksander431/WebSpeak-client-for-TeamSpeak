<template>
  <div
    class="gm-panel"
    data-ws-part="voice.game"
    role="dialog"
    aria-modal="true"
    :aria-label="x.dnd"
    @keydown.esc="emit('close')"
  >
    <header class="gm-top" data-ws-part="voice.game.header">
      <div class="gm-crumbs">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 21 7v10l-9 5-9-5V7l9-5Z" /><path d="M12 2v20M3 7l9 5 9-5" /></svg>
        <span class="gm-muted">{{ channelName }}</span>
        <span class="gm-sep">/</span>
        <strong class="gm-gold">{{ x.dnd }}</strong>
        <span v-if="table" class="gm-pill">{{ roleLabel }}</span>
      </div>
      <div class="gm-top-actions">
        <button v-if="table?.phase === 'playing' && role === 'gm'" type="button" class="gm-btn" @click="client.end()">{{ x.end }}</button>
        <button type="button" class="gm-btn" @click="emit('close')">{{ x.close }}</button>
      </div>
    </header>

    <p v-if="client.state.error" class="gm-error" role="alert">
      {{ x.errors[client.state.error] ?? x.errorFallback }}
      <button type="button" class="gm-link" :aria-label="x.close" @click="client.clearError()">×</button>
    </p>

    <main v-if="!table" class="gm-loading" aria-busy="true"><span class="gm-spinner" aria-hidden="true"></span></main>

    <!-- ===== Lobby ===== -->
    <main v-else-if="table.phase === 'lobby'" class="gm-body gm-lobby">
      <section class="gm-col gm-seats" aria-labelledby="gm-seats-title">
        <h1 id="gm-seats-title" class="gm-display">{{ x.lobbyTitle }}</h1>
        <p class="gm-muted">{{ x.lobbyLead }}</p>

        <div class="gm-seat gm-seat-gm">
          <span class="gm-avatar gm-avatar-gold">{{ initial(table.gm?.nickname ?? "?") }}</span>
          <span class="gm-seat-text">
            <strong>{{ table.gm?.nickname ?? x.noGm }}</strong>
            <span class="gm-gold">{{ x.gm }}<template v-if="table.gm && !table.gm.online"> · {{ x.offline }}</template></span>
          </span>
          <span v-if="table.gm" :class="table.gm.ready ? 'gm-ok' : 'gm-muted'">{{ table.gm.ready ? x.ready : x.notReady }}</span>
        </div>

        <div class="gm-seat-grid">
          <div v-for="seat in table.players" :key="seat.key" :class="['gm-seat', { 'gm-seat-mine': seat.key === table.you.key }]">
            <span class="gm-avatar">{{ initial(seat.nickname) }}</span>
            <span class="gm-seat-text">
              <strong>{{ seat.nickname }}</strong>
              <span class="gm-muted">{{ heroLine(seat.heroId) }}<template v-if="!seat.online"> · {{ x.offline }}</template></span>
            </span>
            <span :class="seat.ready ? 'gm-ok' : 'gm-muted'">{{ seat.ready ? x.ready : x.notReady }}</span>
          </div>
          <button v-if="role !== 'player' && table.players.length < MAX_PLAYERS" type="button" class="gm-seat gm-seat-free" @click="client.seat('player')">
            <strong>{{ x.freeSeat }}</strong><span class="gm-muted">{{ x.takePlayer }}</span>
          </button>
        </div>

        <div class="gm-row">
          <button v-if="role !== 'gm' && (!table.gm || !table.gm.online)" type="button" class="gm-btn" @click="client.seat('gm')">{{ x.takeGm }}</button>
          <button v-if="role !== 'spectator'" type="button" class="gm-btn" @click="client.seat('spectator')">{{ x.leaveSeat }}</button>
        </div>
      </section>

      <section class="gm-col gm-wide" aria-labelledby="gm-adventure-title">
        <div class="gm-card">
          <div class="gm-card-head"><h2 id="gm-adventure-title">{{ x.adventure }}</h2><span class="gm-muted">{{ x.adventurePick }}</span></div>
          <label v-for="item in BUILT_IN_ADVENTURES" :key="item.id" :class="['gm-choice', { 'gm-choice-on': table.adventureId === item.id }]">
            <input type="radio" name="gm-adventure" :value="item.id" :checked="table.adventureId === item.id" :disabled="role !== 'gm'" @change="client.adventure(item.id)" />
            <span class="gm-choice-text">
              <strong class="gm-display gm-display-s">{{ item.title }}</strong>
              <span class="gm-muted">{{ item.length }} · {{ item.level }} {{ x.levelShort }}</span>
              <span>{{ item.summary }}</span>
            </span>
          </label>
        </div>

        <div v-if="adventure" class="gm-card">
          <div class="gm-card-head"><h2>{{ role === 'player' ? x.heroPick : x.heroes }}</h2></div>
          <div class="gm-hero-grid">
            <button
              v-for="hero in adventure.heroes"
              :key="hero.id"
              type="button"
              :class="['gm-hero', { 'gm-hero-on': mySeat?.heroId === hero.id, 'gm-hero-taken': takenBy(hero.id) && mySeat?.heroId !== hero.id }]"
              :disabled="role !== 'player' || Boolean(takenBy(hero.id) && mySeat?.heroId !== hero.id)"
              :aria-pressed="mySeat?.heroId === hero.id"
              @click="client.hero(hero.id)"
            >
              <img v-if="hero.portrait" class="gm-avatar gm-avatar-l gm-portrait" :src="hero.portrait" alt="" /><span v-else class="gm-avatar gm-avatar-l">{{ initial(hero.name) }}</span>
              <span class="gm-hero-text">
                <strong>{{ hero.name }}</strong>
                <span class="gm-muted">{{ hero.race }} · {{ hero.cls }}</span>
                <span class="gm-hero-stats">{{ x.hp }} {{ hero.maxHp }} · {{ x.ac }} {{ hero.ac }}</span>
                <span v-if="takenBy(hero.id)" class="gm-tag">{{ mySeat?.heroId === hero.id ? x.heroYours : `${x.heroTaken}: ${takenBy(hero.id)}` }}</span>
              </span>
            </button>
          </div>
          <p v-if="previewHero" class="gm-story">{{ previewHero.story }}</p>
        </div>
      </section>

      <aside class="gm-col gm-narrow">
        <div class="gm-card">
          <template v-if="role === 'spectator'"><p class="gm-muted">{{ x.spectating }}</p></template>
          <template v-else>
            <button v-if="role === 'player' && mySeat?.heroId" type="button" class="gm-btn" @click="client.hero(null)">{{ x.heroDrop }}</button>
            <button type="button" :class="['gm-btn', 'gm-btn-big', { 'gm-btn-gold': !ownReady }]" @click="client.ready(!ownReady)">{{ ownReady ? x.notReady : x.ready }}</button>
            <button v-if="role === 'gm'" type="button" class="gm-btn gm-btn-big gm-btn-gold" :disabled="!canStart" :title="x.startHint" @click="client.start()">{{ x.start }}</button>
            <p v-if="role === 'gm' && !canStart" class="gm-muted gm-small">{{ x.startHint }}</p>
          </template>
        </div>
        <p class="gm-muted gm-small">{{ x.sceneSoon }}</p>
      </aside>
    </main>

    <!-- ===== Playing ===== -->
    <main v-else :class="['gm-body', 'gm-play', { 'gm-play-nosheet': !hasLeft || wide }]">
      <!-- Player: own hero sheet -->
      <section v-if="role === 'player' && myHero && mySeat" v-show="!wide" class="gm-col gm-sheet gm-scroll" :aria-label="myHero.name">
        <div class="gm-card">
          <div class="gm-hero-head">
            <img v-if="myHero.portrait" class="gm-avatar gm-avatar-xl gm-portrait" :src="myHero.portrait" alt="" /><span v-else class="gm-avatar gm-avatar-xl">{{ initial(myHero.name) }}</span>
            <span class="gm-hero-text">
              <strong class="gm-display gm-display-s">{{ myHero.name }}</strong>
              <span class="gm-muted">{{ myHero.race }} · {{ myHero.cls }} {{ myHero.level }} {{ x.levelShort }}</span>
            </span>
          </div>
          <div class="gm-stat-row">
            <div class="gm-stat">
              <div class="gm-hp">
                <button type="button" class="gm-mini" :aria-label="x.hpMinus" @click="client.setHp(mySeat.key, (mySeat.hp ?? 0) - 1)">−</button>
                <strong :class="hpClass(mySeat.hp, myHero.maxHp)">{{ mySeat.hp }}<small>/{{ myHero.maxHp }}</small></strong>
                <button type="button" class="gm-mini" :aria-label="x.hpPlus" @click="client.setHp(mySeat.key, (mySeat.hp ?? 0) + 1)">+</button>
              </div>
              <span class="gm-muted gm-small">{{ x.hp }}</span>
            </div>
            <div class="gm-stat"><strong>{{ myHero.ac }}</strong><span class="gm-muted gm-small">{{ x.ac }}</span></div>
            <button type="button" class="gm-stat gm-stat-btn" @click="roll({ type: 'initiative' })"><strong>{{ mod(myHero.abilities.dex) }}</strong><span class="gm-muted gm-small">{{ x.initiative }}</span></button>
            <div class="gm-stat"><strong>{{ myHero.speed }}</strong><span class="gm-muted gm-small">{{ x.speed }}, {{ x.feet }}</span></div>
          </div>
          <div class="gm-abilities">
            <button v-for="ability in ABILITIES" :key="ability" type="button" class="gm-ability" :title="x.abilityName[ability]" @click="roll({ type: 'ability', ability })">
              <span class="gm-muted gm-small">{{ x.abilityShort[ability] }}</span>
              <strong>{{ mod(myHero.abilities[ability]) }}</strong>
              <span class="gm-muted gm-small">{{ myHero.abilities[ability] }}</span>
            </button>
          </div>
        </div>

        <div class="gm-card">
          <h2>{{ x.actions }}</h2>
          <div v-for="(attack, index) in myHero.attacks" :key="attack.name" class="gm-action">
            <span class="gm-action-text"><strong>{{ attack.name }}</strong><span class="gm-muted gm-small">{{ attack.note }}</span></span>
            <button v-if="attack.bonus !== null" type="button" class="gm-chip gm-chip-gold" @click="roll({ type: 'attack', index })">{{ signed(attack.bonus) }}</button>
            <button type="button" class="gm-chip" @click="roll({ type: 'damage', index })">{{ attack.damage.replace(/d/g, x === TEXT_RU ? 'к' : 'd') }}</button>
            <button type="button" class="gm-chip" :title="x.crit" @click="roll({ type: 'damage', index, crit: true })">{{ x.crit }}</button>
          </div>
        </div>

        <div class="gm-card">
          <div class="gm-tabs" role="tablist">
            <button v-for="tab in sheetTabs" :key="tab.id" type="button" role="tab" :aria-selected="sheetTab === tab.id" :class="['gm-tab', { 'gm-tab-on': sheetTab === tab.id }]" @click="sheetTab = tab.id">{{ tab.label }}</button>
          </div>
          <div v-if="sheetTab === 'skills'" class="gm-skill-grid">
            <button v-for="skill in SKILL_IDS" :key="skill" type="button" :class="['gm-skill', { 'gm-skill-prof': myHero.skills.includes(skill) }]" @click="roll({ type: 'skill', skill })">
              <span>{{ x.skillName[skill] }}</span><strong>{{ signed(skillBonus(myHero, skill)) }}</strong>
            </button>
          </div>
          <div v-else-if="sheetTab === 'saves'" class="gm-skill-grid">
            <button v-for="ability in ABILITIES" :key="ability" type="button" :class="['gm-skill', { 'gm-skill-prof': myHero.saves.includes(ability) }]" @click="roll({ type: 'save', ability })">
              <span>{{ x.abilityName[ability] }}</span><strong>{{ signed(saveBonus(myHero, ability)) }}</strong>
            </button>
          </div>
          <ul v-else class="gm-list">
            <li v-for="line in sheetLines" :key="line">{{ line }}</li>
          </ul>
        </div>
      </section>

      <!-- Game master: the party and checks -->
      <section v-else-if="role === 'gm'" v-show="!wide" class="gm-col gm-sheet gm-scroll" :aria-label="x.party">
        <div class="gm-card">
          <h2>{{ x.party }}</h2>
          <div v-for="seat in partySeats" :key="seat.key" class="gm-party">
            <img v-if="seat.hero.portrait" class="gm-avatar gm-portrait" :src="seat.hero.portrait" alt="" /><span v-else class="gm-avatar">{{ initial(seat.hero.name) }}</span>
            <span class="gm-party-text">
              <strong>{{ seat.hero.name }}</strong>
              <span class="gm-muted gm-small">{{ seat.nickname }}<template v-if="!seat.online"> · {{ x.offline }}</template> · {{ x.ac }} {{ seat.hero.ac }}</span>
              <span class="gm-bar"><span :style="{ width: `${Math.max(0, Math.min(100, ((seat.hp ?? 0) / seat.hero.maxHp) * 100))}%` }" :class="hpClass(seat.hp, seat.hero.maxHp)"></span></span>
            </span>
            <span class="gm-hp">
              <button type="button" class="gm-mini" :aria-label="x.hpMinus" @click="client.setHp(seat.key, (seat.hp ?? 0) - 1)">−</button>
              <strong>{{ seat.hp }}<small>/{{ seat.hero.maxHp }}</small></strong>
              <button type="button" class="gm-mini" :aria-label="x.hpPlus" @click="client.setHp(seat.key, (seat.hp ?? 0) + 1)">+</button>
            </span>
          </div>
        </div>

        <form class="gm-card gm-form" @submit.prevent="sendCheck">
          <h2>{{ x.requestCheck }}</h2>
          <label class="gm-field">
            <span class="gm-muted gm-small">{{ x.checkKind }}</span>
            <select v-model="checkKey" class="gm-input">
              <optgroup :label="x.skills"><option v-for="skill in SKILL_IDS" :key="skill" :value="`skill:${skill}`">{{ x.skillName[skill] }}</option></optgroup>
              <optgroup :label="x.abilities"><option v-for="ability in ABILITIES" :key="ability" :value="`ability:${ability}`">{{ x.abilityName[ability] }}</option></optgroup>
              <optgroup :label="x.saves"><option v-for="ability in ABILITIES" :key="ability" :value="`save:${ability}`">{{ x.saves }}: {{ x.abilityName[ability] }}</option></optgroup>
            </select>
          </label>
          <div class="gm-row">
            <label class="gm-field gm-field-s"><span class="gm-muted gm-small">{{ x.checkDc }}</span><input v-model.number="checkDc" class="gm-input" type="number" min="1" max="40" /></label>
            <label class="gm-field"><span class="gm-muted gm-small">{{ x.dice }}</span>
              <select v-model="checkMode" class="gm-input"><option value="normal">{{ x.normal }}</option><option value="advantage">{{ x.advantage }}</option><option value="disadvantage">{{ x.disadvantage }}</option></select>
            </label>
          </div>
          <fieldset class="gm-who">
            <legend class="gm-muted gm-small">{{ x.checkWho }}</legend>
            <label v-for="seat in partySeats" :key="seat.key"><input v-model="checkTargets" type="checkbox" :value="seat.key" /> {{ seat.hero.name }}</label>
            <span v-if="!checkTargets.length" class="gm-muted gm-small">{{ x.everyone }}</span>
          </fieldset>
          <button type="submit" class="gm-btn gm-btn-gold">{{ x.send }}</button>
        </form>

        <div v-if="table.checks.length" class="gm-card">
          <h2>{{ x.pendingChecks }}</h2>
          <div v-for="check in table.checks" :key="check.id" class="gm-check-line">
            <span><strong>{{ check.label }}</strong> · {{ x.checkDc.split(' ')[0] }} {{ check.dc }}<br /><span class="gm-muted gm-small">{{ x.waiting }}: {{ waitingNames(check.targets, check.done) }}</span></span>
            <button type="button" class="gm-btn" @click="client.cancelCheck(check.id)">{{ x.cancel }}</button>
          </div>
        </div>

        <div v-if="sceneMap && adventure" class="gm-card">
          <h2>{{ x.monsters }}</h2>
          <p v-if="placing" class="gm-muted gm-small">{{ x.placeHint }}</p>
          <button
            v-for="monster in adventure.monsters"
            :key="monster.id"
            type="button"
            :class="['gm-monster', { 'gm-monster-on': placing === monster.id }]"
            :aria-pressed="placing === monster.id"
            @click="placing = placing === monster.id ? null : monster.id"
          >
            <img v-if="monster.portrait" class="gm-avatar gm-portrait" :src="monster.portrait" alt="" /><span v-else class="gm-avatar">{{ initial(monster.name) }}</span>
            <span class="gm-party-text"><strong>{{ monster.name }}</strong><span class="gm-muted gm-small">{{ x.cr }} {{ monster.cr }} · {{ x.hp }} {{ monster.maxHp }} · {{ x.ac }} {{ monster.ac }}</span></span>
          </button>
        </div>
      </section>


      <section class="gm-stage" data-ws-part="voice.game.stage" :aria-label="x.scene">
        <header class="gm-stage-head">
          <button v-if="role === 'gm'" type="button" class="gm-mini" :aria-label="x.prevScene" :title="x.prevScene" :disabled="table.scene <= 0" @click="client.scene(table.scene - 1)">‹</button>
          <span v-if="role !== 'gm'" class="gm-muted gm-small gm-nowrap">{{ x.scene }} {{ table.scene + 1 }}/{{ adventure?.scenes.length ?? 1 }}</span>
          <select v-if="role === 'gm' && adventure" class="gm-input gm-scene-select" :value="table.scene" :aria-label="x.scene" @change="client.scene(Number(($event.target as HTMLSelectElement).value))">
            <option v-for="(item, index) in adventure.scenes" :key="item.id" :value="index">{{ index + 1 }}. {{ item.title }} ({{ item.map ? x.mapScene : x.storyScene }})</option>
          </select>
          <strong v-else class="gm-display gm-display-s">{{ scene?.title }}</strong>
          <button v-if="role === 'gm'" type="button" class="gm-mini" :aria-label="x.nextScene" :title="x.nextScene" :disabled="!adventure || table.scene >= adventure.scenes.length - 1" @click="client.scene(table.scene + 1)">›</button>
          <button v-if="hasLeft" type="button" class="gm-btn gm-wide-toggle" :aria-pressed="wide" @click="wide = !wide">{{ wide ? (role === 'gm' ? x.showTools : x.showSheet) : x.widen }}</button>
        </header>
        <GameMap
          v-if="table.map && sceneMap"
          v-model:placing="placing"
          :client="client"
          :map="table.map"
          :scene-map="sceneMap"
          :adventure-id="table.adventureId"
          :role="role"
          :you-key="table.you.key"
          :seats="table.players"
          :x="x"
        />
        <figure v-else class="gm-art" :key="scene?.id">
          <img v-if="scene?.art" :src="scene.art" alt="" />
          <figcaption><strong class="gm-display">{{ scene?.title }}</strong></figcaption>
        </figure>
      </section>

      <section class="gm-col gm-side gm-scroll" :aria-label="x.turnLog">
        <div v-for="check in playerChecks" :key="check.id" class="gm-card gm-ask" role="alert">
          <span class="gm-muted">{{ x.checkAsked }}</span>
          <strong class="gm-display">{{ check.label }}</strong>
          <span class="gm-muted gm-small">{{ x.checkHiddenDc }}<template v-if="check.mode !== 'normal'"> · {{ check.mode === 'advantage' ? x.advantage : x.disadvantage }}</template></span>
          <button type="button" class="gm-btn gm-btn-big gm-btn-gold" @click="client.roll(check.source, mode, false, check.id)">{{ x.rollCheck }}</button>
        </div>

        <div v-if="role !== 'gm'" class="gm-card">
          <h2>{{ x.party }}</h2>
          <div v-for="seat in partySeats" :key="seat.key" class="gm-party gm-party-s">
            <img v-if="seat.hero.portrait" class="gm-avatar gm-portrait" :src="seat.hero.portrait" alt="" /><span v-else class="gm-avatar">{{ initial(seat.hero.name) }}</span>
            <span class="gm-party-text">
              <strong>{{ seat.hero.name }}</strong>
              <span class="gm-bar"><span :style="{ width: `${Math.max(0, Math.min(100, ((seat.hp ?? 0) / seat.hero.maxHp) * 100))}%` }" :class="hpClass(seat.hp, seat.hero.maxHp)"></span></span>
            </span>
            <span class="gm-muted gm-small">{{ seat.hp }}/{{ seat.hero.maxHp }}</span>
          </div>
          <p v-if="table.gm" class="gm-muted gm-small">{{ x.gm }}: {{ table.gm.nickname }}</p>
        </div>

        <div v-if="role !== 'spectator'" class="gm-card gm-tray">
          <div class="gm-row gm-dice-row">
            <button v-for="sides in [4, 6, 8, 10, 12, 20, 100]" :key="sides" type="button" class="gm-die" @click="roll({ type: 'free', expr: `1d${sides}` })">{{ diePrefix }}{{ sides }}</button>
          </div>
          <form class="gm-row" @submit.prevent="rollCustom">
            <input v-model="customExpr" class="gm-input gm-grow" :placeholder="x.custom" :aria-label="x.custom" maxlength="40" />
            <button type="submit" class="gm-btn">{{ x.rollIt }}</button>
          </form>
          <div class="gm-row gm-modes" role="radiogroup" :aria-label="x.dice">
            <label v-for="item in modes" :key="item.id" :class="['gm-mode', { 'gm-mode-on': mode === item.id }]"><input v-model="mode" type="radio" :value="item.id" />{{ item.label }}</label>
          </div>
          <label v-if="role === 'gm'" class="gm-check"><input v-model="hiddenRoll" type="checkbox" /> {{ x.hidden }}</label>
        </div>

        <div class="gm-card gm-log">
          <h2>{{ x.turnLog }}</h2>
          <p v-if="!table.rolls.length" class="gm-muted">{{ x.noRolls }}</p>
          <ol class="gm-log-list">
            <li v-for="item in reversedRolls" :key="item.id" :class="['gm-log-item', { 'gm-log-secret': item.secret }]">
              <span class="gm-log-who">{{ item.heroName ?? item.by }}</span>
              <span class="gm-log-what">{{ item.secret ? x.secretRoll : item.label }}<template v-if="item.hidden && !item.secret"> · {{ x.hidden.split(' (')[0] }}</template></span>
              <span v-if="!item.secret" class="gm-log-dice">{{ diceText(item) }}</span>
              <strong v-if="!item.secret" :class="['gm-log-total', rollClass(item)]">{{ item.total }}</strong>
              <span v-if="item.success !== undefined" :class="item.success ? 'gm-ok' : 'gm-bad'">{{ item.success ? x.success : x.failure }}<template v-if="item.dc !== undefined"> · {{ item.dc }}</template></span>
            </li>
          </ol>
        </div>
        <p v-if="role === 'spectator'" class="gm-muted gm-small">{{ x.spectating }}</p>
      </section>
    </main>

    <!-- Dice animation -->
    <div v-if="shownRoll" :key="shownRoll.id" class="gm-roll" aria-live="polite" @click="shownRoll = null">
      <div class="gm-roll-card">
        <span class="gm-muted">{{ shownRoll.heroName ?? shownRoll.by }}</span>
        <template v-if="shownRoll.secret">
          <strong class="gm-display">{{ x.secretRoll }}</strong>
        </template>
        <template v-else>
          <div class="gm-roll-dice">
            <span v-for="(die, index) in shownRoll.dice ?? []" :key="index" :class="['gm-roll-die', `gm-sides-${die.sides}`, { 'gm-dropped': die.dropped, 'gm-nat20': die.sides === 20 && die.value === 20 && !die.dropped, 'gm-nat1': die.sides === 20 && die.value === 1 && !die.dropped }]" :style="{ animationDelay: `${index * 90}ms` }">
              <svg v-if="die.sides === 20" viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,4 92,28 92,72 50,96 8,72 8,28" /><polygon class="gm-face" points="50,22 76,64 24,64" /></svg>
              <svg v-else viewBox="0 0 100 100" aria-hidden="true"><rect x="10" y="10" width="80" height="80" rx="16" /></svg>
              <b>{{ die.value }}</b>
            </span>
          </div>
          <strong :class="['gm-display', 'gm-roll-title', rollClass(shownRoll)]">{{ rollHeadline(shownRoll) }}</strong>
          <span class="gm-roll-sum">{{ shownRoll.label }} · <b>{{ shownRoll.total }}</b></span>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ABILITIES, MAX_PLAYERS, SKILL_IDS, abilityModifier, formatModifier, saveBonus, skillBonus, type CheckSource, type RollMode, type RollSource, type RollView } from "../../../../src/shared/tabletop.js";
import { BUILT_IN_ADVENTURES, findAdventure, findHero } from "../../../../src/shared/tabletop-adventures.js";
import GameMap from "./GameMap.vue";
import type { GameClient } from "../../game/game-client.js";
import { dndText } from "../../game/dnd-text.js";

const props = defineProps<{ client: GameClient; channelName: string; language: string }>();
const emit = defineEmits<{ close: [] }>();

const x = computed(() => dndText(props.language));
const TEXT_RU = dndText("ru");
const diePrefix = computed(() => (x.value === TEXT_RU ? "к" : "d"));
const table = computed(() => props.client.state.table);
const role = computed(() => table.value?.you.role ?? "spectator");
const roleLabel = computed(() => role.value === "gm" ? x.value.gm : role.value === "player" ? x.value.player : x.value.spectator);
const adventure = computed(() => findAdventure(table.value?.adventureId));
const mySeat = computed(() => table.value?.players.find(seat => seat.key === table.value?.you.key) ?? null);
const myHero = computed(() => findHero(table.value?.adventureId, mySeat.value?.heroId));
const ownReady = computed(() => role.value === "gm" ? Boolean(table.value?.gm?.ready) : Boolean(mySeat.value?.ready));
const previewHero = computed(() => myHero.value ?? null);
const canStart = computed(() => {
  const players = table.value?.players.filter(seat => seat.heroId) ?? [];
  return Boolean(table.value?.adventureId) && players.length > 0 && players.every(seat => seat.ready);
});
const partySeats = computed(() => (table.value?.players ?? []).flatMap(seat => {
  const hero = findHero(table.value?.adventureId, seat.heroId);
  return hero ? [{ ...seat, hero }] : [];
}));
const playerChecks = computed(() => role.value === "player"
  ? (table.value?.checks ?? []).filter(check => check.targets.includes(table.value!.you.key) && !check.done.includes(table.value!.you.key)) : []);
const scene = computed(() => adventure.value?.scenes[table.value?.scene ?? 0]);
const sceneMap = computed(() => scene.value?.map);
const hasLeft = computed(() => role.value === "gm" || (role.value === "player" && Boolean(myHero.value && mySeat.value)));
/** Hide the left column to give the scene more room. */
const wide = ref(false);
/** The monster the game master is placing on the map. */
const placing = ref<string | null>(null);
watch(sceneMap, map => { if (!map) placing.value = null; });
const reversedRolls = computed(() => [...(table.value?.rolls ?? [])].reverse());

const mode = ref<RollMode>("normal");
const modes = computed(() => [
  { id: "normal" as const, label: x.value.normal },
  { id: "advantage" as const, label: x.value.advantage },
  { id: "disadvantage" as const, label: x.value.disadvantage },
]);
const hiddenRoll = ref(false);
const customExpr = ref("");
const sheetTab = ref<"skills" | "saves" | "features" | "equipment" | "story">("skills");
const sheetTabs = computed(() => [
  { id: "skills" as const, label: x.value.skills },
  { id: "saves" as const, label: x.value.saves },
  { id: "features" as const, label: x.value.features },
  { id: "equipment" as const, label: x.value.equipment },
  { id: "story" as const, label: x.value.story },
]);
const sheetLines = computed(() => {
  const hero = myHero.value;
  if (!hero) return [];
  if (sheetTab.value === "features") return [...hero.features, ...(hero.spells?.length ? [`${x.value.spells}: ${hero.spells.join(", ")}`] : [])];
  if (sheetTab.value === "equipment") return hero.equipment;
  return [hero.story];
});

const checkKey = ref("skill:perception");
const checkDc = ref(12);
const checkMode = ref<RollMode>("normal");
const checkTargets = ref<string[]>([]);

function sendCheck(): void {
  const [type, value] = checkKey.value.split(":");
  const source = (type === "skill" ? { type, skill: value } : { type, ability: value }) as CheckSource;
  props.client.requestCheck(source, Math.max(1, Math.min(40, Math.round(Number(checkDc.value) || 10))), checkMode.value, checkTargets.value);
}

function roll(source: RollSource): void {
  props.client.roll(source, mode.value, role.value === "gm" && hiddenRoll.value);
}
function rollCustom(): void {
  const expr = customExpr.value.trim();
  if (expr) roll({ type: "free", expr });
}

const initial = (name: string) => [...name.trim()][0]?.toUpperCase() ?? "?";
const mod = (score: number) => formatModifier(abilityModifier(score));
const signed = (value: number) => formatModifier(value);
function heroLine(heroId: string | null): string {
  const hero = findHero(table.value?.adventureId, heroId);
  return hero ? `${hero.name} · ${hero.cls}` : x.value.choosingHero;
}
function takenBy(heroId: string): string {
  return table.value?.players.find(seat => seat.heroId === heroId)?.nickname ?? "";
}
function waitingNames(targets: string[], done: string[]): string {
  return targets.filter(key => !done.includes(key)).map(key => partySeats.value.find(seat => seat.key === key)?.hero.name ?? "?").join(", ");
}
function hpClass(hp: number | null, max: number): string {
  const ratio = (hp ?? 0) / max;
  return ratio <= 0 ? "gm-hp-down" : ratio < 0.5 ? "gm-hp-low" : "gm-hp-ok";
}
function diceText(item: RollView): string {
  const dice = (item.dice ?? []).map(die => (die.dropped ? `(${die.value})` : String(die.value))).join(" ");
  const modifier = item.modifier ? ` ${formatModifier(item.modifier)}` : "";
  return `${item.expr ?? ""}: ${dice}${modifier}`;
}
function rollClass(item: RollView): string {
  if (item.natural === 20) return "gm-crit";
  if (item.natural === 1) return "gm-fumble";
  return "";
}
function rollHeadline(item: RollView): string {
  if (item.natural === 20) return x.value.critSuccess;
  if (item.natural === 1) return x.value.critFail;
  if (item.success !== undefined) return item.success ? x.value.success : x.value.failure;
  return String(item.total ?? "");
}

// Every new roll is shown over the table for a moment.
const shownRoll = ref<RollView | null>(null);
let hideTimer: ReturnType<typeof setTimeout> | undefined;
watch(() => props.client.lastRoll.value, item => {
  if (!item) return;
  shownRoll.value = item;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { shownRoll.value = null; }, item.secret ? 1600 : 2600);
});
onBeforeUnmount(() => clearTimeout(hideTimer));
</script>

<style scoped>
.gm-panel {
  --gm-bg: #141519;
  --gm-card: #1a1b20;
  --gm-raised: #23252b;
  --gm-line: #2a2c33;
  --gm-line-2: #3a3c44;
  --gm-text: #e8e6e1;
  --gm-muted: #a9a6a0;
  --gm-gold: #d9b46c;
  --gm-gold-soft: #3a3020;
  --gm-ok: #8fd18f;
  --gm-bad: #e08a8a;
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--gm-text);
  background: var(--gm-bg);
  font-family: Inter, system-ui, sans-serif;
  font-size: 14px;
}
.gm-panel svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linejoin: round; }
.gm-top { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 10px 20px; border-bottom: 1px solid var(--gm-line); background: #1a1b20; }
.gm-crumbs { display: flex; align-items: center; gap: 10px; flex: 1 1 auto; min-width: 0; color: var(--gm-gold); }
.gm-top-actions { display: flex; gap: 8px; }
.gm-sep { color: #5d5b57; }
.gm-gold { color: var(--gm-gold); }
.gm-muted { color: var(--gm-muted); }
.gm-small { font-size: 12px; }
.gm-ok { color: var(--gm-ok); }
.gm-bad { color: var(--gm-bad); }
.gm-pill { padding: 3px 10px; border-radius: 999px; background: var(--gm-gold-soft); color: var(--gm-gold); font-size: 12px; font-weight: 600; }
.gm-display { font-family: "Cormorant Garamond", Georgia, serif; font-weight: 700; color: #f1e6cf; font-size: 34px; line-height: 1.1; margin: 0; }
.gm-display-s { font-size: 22px; }
h2 { margin: 0 0 10px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #8d8a84; }
.gm-error { margin: 0; padding: 8px 20px; background: #3a2222; color: #f3c9c9; display: flex; align-items: center; gap: 10px; }
.gm-link { margin-left: auto; border: 0; background: none; color: inherit; font-size: 20px; cursor: pointer; min-width: 32px; min-height: 32px; }
.gm-loading { flex: 1; display: grid; place-items: center; }
.gm-spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--gm-line-2); border-top-color: var(--gm-gold); animation: gm-spin 1s linear infinite; }
@keyframes gm-spin { to { transform: rotate(360deg); } }

.gm-body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px; padding: 18px; box-sizing: border-box; }
.gm-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.gm-seats { flex: 1 1 300px; max-width: 420px; }
.gm-wide, .gm-center { flex: 999 1 420px; }
.gm-narrow { flex: 1 1 240px; max-width: 320px; }
.gm-sheet { flex: 1 1 340px; max-width: 420px; }
.gm-play { display: grid; grid-template-columns: minmax(260px, 330px) minmax(0, 1fr) minmax(240px, 300px); align-items: stretch; overflow: hidden; padding: 14px; gap: 14px; }
.gm-play-nosheet { grid-template-columns: minmax(0, 1fr) minmax(240px, 300px); }
.gm-wide-toggle { margin-left: auto; min-height: 34px; font-size: 13px; white-space: nowrap; flex: none; }
.gm-nowrap { white-space: nowrap; }
.gm-play > .gm-sheet, .gm-play > .gm-side { max-width: none; min-height: 0; }
.gm-scroll { overflow: auto; padding-right: 2px; }
.gm-stage { display: flex; flex-direction: column; gap: 10px; min-width: 0; min-height: 0; }
.gm-stage-head { display: flex; align-items: center; gap: 10px; min-height: 40px; }
.gm-stage-head .gm-display-s { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gm-scene-select { flex: 1 1 auto; width: auto; max-width: 520px; }
.gm-mini:disabled { opacity: .35; cursor: default; }
.gm-art { position: relative; flex: 1; min-height: 0; margin: 0; overflow: hidden; border-radius: 14px; border: 1px solid var(--gm-line); background: #08090b; }
.gm-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; animation: gm-art-in 1.2s ease both; }
.gm-art figcaption { position: absolute; left: 0; right: 0; bottom: 0; padding: 60px 28px 22px; background: linear-gradient(transparent, rgba(8, 9, 11, 0.92)); }
.gm-art .gm-display { font-size: 40px; text-shadow: 0 2px 12px #000; }
@keyframes gm-art-in { from { opacity: 0; transform: scale(1.04); } to { opacity: 1; transform: none; } }
.gm-portrait { object-fit: cover; padding: 0; }
.gm-monster { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 10px; border: 1px solid transparent; background: var(--gm-raised); color: var(--gm-text); font: inherit; text-align: left; cursor: pointer; }
.gm-monster:hover { border-color: var(--gm-line-2); }
.gm-monster-on { border-color: var(--gm-gold); background: #221f18; }
.gm-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 14px; background: var(--gm-card); border: 1px solid var(--gm-line); }
.gm-card-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.gm-card-head h2 { margin: 0; }
.gm-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.gm-grow { flex: 1 1 160px; }

.gm-btn { min-height: 40px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--gm-line-2); background: transparent; color: var(--gm-text); font: inherit; cursor: pointer; }
.gm-btn:hover:not(:disabled) { background: var(--gm-raised); }
.gm-btn:disabled { opacity: .45; cursor: not-allowed; }
.gm-btn-big { min-height: 48px; font-weight: 600; }
.gm-btn-gold { border-color: var(--gm-gold); background: var(--gm-gold); color: #1a1408; }
.gm-btn-gold:hover:not(:disabled) { background: #e8c77f; }

.gm-avatar { flex: none; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: #2c3a4a; color: #fff; font-weight: 600; }
.gm-avatar-gold { background: #4a3d22; color: #f1e6cf; }
.gm-avatar-l { width: 52px; height: 52px; border-radius: 12px; background: #2c4a3a; font-size: 20px; }
.gm-avatar-xl { width: 64px; height: 64px; border-radius: 14px; background: #2c4a3a; font-size: 24px; border: 2px solid var(--gm-gold); }
.gm-seat { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; background: var(--gm-card); border: 1px solid var(--gm-line); color: var(--gm-text); font: inherit; text-align: left; }
.gm-seat-gm { background: #221f18; border-color: #4a3d22; }
.gm-seat-mine { border-color: var(--gm-gold); }
.gm-seat-text { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.gm-seat-grid { display: flex; flex-direction: column; gap: 8px; }
.gm-seat-free { flex-direction: column; align-items: flex-start; gap: 2px; border-style: dashed; background: transparent; cursor: pointer; min-height: 56px; }

.gm-choice { display: flex; gap: 12px; padding: 12px; border-radius: 12px; border: 1px solid var(--gm-line); cursor: pointer; }
.gm-choice-on { border-color: var(--gm-gold); background: #221f18; }
.gm-choice input { accent-color: var(--gm-gold); margin-top: 4px; }
.gm-choice-text { display: flex; flex-direction: column; gap: 4px; line-height: 1.4; }
.gm-hero-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.gm-hero { display: flex; gap: 12px; align-items: center; padding: 10px; border-radius: 12px; border: 1px solid var(--gm-line); background: var(--gm-raised); color: var(--gm-text); font: inherit; text-align: left; cursor: pointer; }
.gm-hero:disabled { cursor: default; }
.gm-hero-on { border-color: var(--gm-gold); background: #221f18; }
.gm-hero-taken { opacity: .5; }
.gm-hero-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.gm-hero-stats { font-size: 12px; color: #c9c6bf; }
.gm-tag { align-self: flex-start; padding: 1px 8px; border-radius: 6px; background: var(--gm-gold-soft); color: var(--gm-gold); font-size: 11px; }
.gm-story { margin: 0; font-family: "Cormorant Garamond", Georgia, serif; font-size: 18px; line-height: 1.4; color: #f1e6cf; }

.gm-hero-head { display: flex; gap: 12px; align-items: center; }
.gm-stat-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.gm-stat-row > .gm-stat:first-child { grid-column: 1 / -1; flex-direction: row; justify-content: center; gap: 12px; }
.gm-stat { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 4px; border-radius: 10px; background: var(--gm-raised); border: 1px solid transparent; color: var(--gm-text); font: inherit; }
.gm-stat strong { font-size: 20px; }
.gm-stat-btn { cursor: pointer; border-color: var(--gm-line-2); }
.gm-hp { display: flex; align-items: center; gap: 6px; }
.gm-hp small { color: var(--gm-muted); font-size: 12px; }
.gm-mini { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--gm-line-2); background: transparent; color: var(--gm-text); font: inherit; font-size: 16px; cursor: pointer; }
.gm-hp-ok { color: var(--gm-ok); }
.gm-hp-low { color: #e8c77f; }
.gm-hp-down { color: var(--gm-bad); }
.gm-abilities { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; }
.gm-ability { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 8px 0; border-radius: 8px; border: 1px solid var(--gm-line-2); background: var(--gm-raised); color: var(--gm-text); font: inherit; cursor: pointer; }
.gm-ability:hover, .gm-skill:hover, .gm-stat-btn:hover, .gm-chip:hover, .gm-die:hover { border-color: var(--gm-gold); }
.gm-action { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; background: var(--gm-raised); }
.gm-action-text { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.gm-chip { min-width: 44px; min-height: 36px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--gm-line-2); background: transparent; color: var(--gm-text); font: inherit; cursor: pointer; }
.gm-chip-gold { color: var(--gm-gold); font-weight: 600; }
.gm-tabs { display: flex; flex-wrap: wrap; gap: 4px; }
.gm-tab { min-height: 34px; padding: 0 10px; border-radius: 8px; border: 0; background: transparent; color: var(--gm-muted); font: inherit; cursor: pointer; }
.gm-tab-on { background: var(--gm-gold-soft); color: #f1e6cf; }
.gm-skill-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.gm-skill { display: flex; justify-content: space-between; gap: 8px; padding: 8px 10px; min-height: 36px; border-radius: 8px; border: 1px solid var(--gm-line); background: transparent; color: #c9c6bf; font: inherit; font-size: 13px; cursor: pointer; text-align: left; }
.gm-skill-prof { color: var(--gm-text); border-color: var(--gm-line-2); background: var(--gm-raised); }
.gm-skill strong { color: var(--gm-text); }
.gm-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; line-height: 1.4; color: #c9c6bf; }

.gm-party { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--gm-line); }
.gm-party:last-of-type { border-bottom: 0; }
.gm-party-text { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.gm-bar { display: block; height: 5px; border-radius: 3px; background: var(--gm-line); overflow: hidden; }
.gm-bar span { display: block; height: 100%; background: currentColor; }
.gm-form { gap: 12px; }
.gm-form > .gm-field { flex: none; }
.gm-field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 140px; }
.gm-field-s { flex: 0 1 110px; }
.gm-input { min-height: 40px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--gm-line-2); background: var(--gm-raised); color: var(--gm-text); font: inherit; box-sizing: border-box; width: 100%; }
.gm-who { margin: 0; padding: 0; border: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
.gm-who legend { width: 100%; margin-bottom: 4px; }
.gm-who input, .gm-check input, .gm-mode input { accent-color: var(--gm-gold); }
.gm-check-line { display: flex; align-items: center; gap: 10px; justify-content: space-between; }

.gm-ask { border-color: var(--gm-gold); background: #1d1a16; align-items: flex-start; }
.gm-tray { gap: 12px; }
.gm-dice-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.gm-die { min-height: 44px; border-radius: 10px; border: 1px solid var(--gm-line-2); background: var(--gm-raised); color: var(--gm-text); font: inherit; cursor: pointer; }
.gm-modes { gap: 6px; }
.gm-mode { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--gm-line); cursor: pointer; }
.gm-mode-on { border-color: var(--gm-gold); background: var(--gm-gold-soft); }
.gm-mode input { position: absolute; opacity: 0; pointer-events: none; }
.gm-check { display: flex; align-items: center; gap: 8px; color: var(--gm-muted); }
.gm-log-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.gm-log-item { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 8px 10px; border-radius: 8px; background: var(--gm-raised); }
.gm-log-secret { background: transparent; border: 1px dashed var(--gm-line-2); }
.gm-log-who { font-weight: 600; }
.gm-log-what { color: #c9c6bf; flex: 1 1 160px; }
.gm-log-dice { color: var(--gm-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.gm-log-total { font-size: 18px; min-width: 32px; text-align: right; }
.gm-crit { color: #f3dcae; text-shadow: 0 0 12px #d9b46c99; }
.gm-fumble { color: var(--gm-bad); }

.gm-roll { position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; background: #0a0b0dcc; animation: gm-fade 2.6s ease forwards; cursor: pointer; }
.gm-roll-card { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 28px 36px; text-align: center; }
.gm-roll-dice { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px; }
.gm-roll-die { position: relative; width: 96px; height: 96px; display: grid; place-items: center; animation: gm-tumble .9s cubic-bezier(.2, .8, .3, 1.1) both; }
.gm-roll-die svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.gm-roll-die svg polygon, .gm-roll-die svg rect { fill: #3a3020; stroke: #f3dcae; stroke-width: 3; }
.gm-roll-die svg .gm-face { fill: none; stroke: #d9b46c; stroke-width: 1.5; }
.gm-roll-die b { position: relative; font-size: 26px; color: #fff6e0; }
.gm-dropped { opacity: .35; transform: scale(.8); }
.gm-nat20 svg polygon:first-child { fill: #6b5520; filter: drop-shadow(0 0 18px #e8c77f); }
.gm-nat1 svg polygon:first-child { fill: #4a2020; stroke: #e08a8a; }
.gm-roll-title { font-size: 46px; animation: gm-rise .5s .7s ease both; }
.gm-roll-sum { color: #c9c6bf; font-size: 18px; animation: gm-rise .5s .8s ease both; }
.gm-roll-sum b { color: #fff6e0; }
@keyframes gm-tumble {
  0% { transform: translateY(-40px) rotate(-200deg) scale(.4); opacity: 0; }
  60% { transform: translateY(6px) rotate(20deg) scale(1.08); opacity: 1; }
  100% { transform: none; }
}
@keyframes gm-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes gm-fade { 0%, 85% { opacity: 1; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .gm-roll, .gm-roll-die, .gm-roll-title, .gm-roll-sum, .gm-spinner, .gm-art img { animation: none; }
}
@media (max-width: 720px) {
  .gm-body { padding: 12px; }
  .gm-seats, .gm-narrow, .gm-sheet { max-width: none; }
  .gm-display { font-size: 28px; }
  .gm-stat-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .gm-dice-row { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .gm-roll-die { width: 72px; height: 72px; }
  .gm-roll-title { font-size: 34px; }
}
</style>
