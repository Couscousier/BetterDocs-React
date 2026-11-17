// Tests de la logique locale (sans appel réseau).
process.env.TWITCH_CLIENT_ID ??= "x";
process.env.TWITCH_CLIENT_SECRET ??= "x";
process.env.TWITCH_BOT_USERNAME ??= "monbot";
process.env.TWITCH_BOT_ACCESS_TOKEN ??= "x";
process.env.TWITCH_CHANNEL ??= "machaine";
process.env.ANTHROPIC_API_KEY ??= "test";

import assert from "node:assert/strict";
import { test } from "node:test";

const { mightBeInsult, decideAction, normalize } = await import("../src/features/moderation.ts");
const { HypeDetector, isHypeMessage } = await import("../src/features/autoclip.ts");
const { toChat, formatSchedule } = await import("../src/features/assistant.ts");

test("le pré-filtre repère les insultes, même déguisées", () => {
  assert.ok(mightBeInsult("t'es qu'un connard"));
  assert.ok(mightBeInsult("c0nnnnard va"));
  assert.ok(mightBeInsult("FDP"));
  assert.ok(mightBeInsult("t'es nul KEKW"));
  assert.ok(mightBeInsult("you are trash"));
  assert.ok(mightBeInsult("kys"));
});

test("le pré-filtre ignore les messages normaux", () => {
  assert.ok(!mightBeInsult("le concert était trop bien"));
  assert.ok(!mightBeInsult("je suis contre cette idée"));
  assert.ok(!mightBeInsult("salut tout le monde !"));
  assert.ok(!mightBeInsult("GG le clutch"));
});

test("normalize gère accents, leet et répétitions", () => {
  assert.equal(normalize("Débiiiile"), "debile");
  assert.equal(normalize("1d10t"), "idiot");
});

const base = { target: "streamer", tone: "hostile", is_insult: true, severity: 2, reason: "", reply: "" } as const;
const opts = { protectViewers: false, strikesBeforeTimeout: 2 };

test("l'humour n'est jamais sanctionné", () => {
  const a = decideAction({ ...base, tone: "humour" }, 5, opts);
  assert.deepEqual(a, { warn: false, deleteMessage: false, timeout: false });
});

test("insulte au streamer : avertissement puis timeout après récidive", () => {
  assert.deepEqual(decideAction(base, 0, opts), { warn: true, deleteMessage: true, timeout: false });
  assert.deepEqual(decideAction({ ...base, severity: 1 }, 0, opts), { warn: true, deleteMessage: false, timeout: false });
  assert.equal(decideAction(base, 2, opts).timeout, true);
});

test("sévérité 3 = timeout immédiat", () => {
  assert.equal(decideAction({ ...base, severity: 3 }, 0, opts).timeout, true);
});

test("insulte entre viewers ignorée sauf si protection activée", () => {
  assert.equal(decideAction({ ...base, target: "viewer" }, 0, opts).warn, false);
  assert.equal(decideAction({ ...base, target: "viewer" }, 0, { ...opts, protectViewers: true }).warn, true);
});

test("détection de pic d'activité", () => {
  const d = new HypeDetector(15_000);
  let now = 0;
  // Chat calme : ~3 messages / 15 s pendant 5 minutes.
  for (let i = 0; i < 60; i++) {
    now += 5_000;
    d.record(now, "salut");
    const r = d.tick(now, { ratio: 2.5, minMessages: 8 });
    assert.equal(r.spike, false);
  }
  // Explosion : 20 messages KEKW en 5 s.
  for (let i = 0; i < 20; i++) d.record(now + i * 200, "KEKW");
  now += 5_000;
  assert.equal(d.tick(now, { ratio: 2.5, minMessages: 8 }).spike, true);
});

test("messages de hype", () => {
  assert.ok(isHypeMessage("KEKW"));
  assert.ok(isHypeMessage("mdrrr le fail"));
  assert.ok(isHypeMessage("CLIIIIP"));
  assert.ok(!isHypeMessage("bonjour"));
});

test("toChat retire le markdown et coupe à 480 caractères", () => {
  assert.equal(toChat("**Salut** [rediff](https://twitch.tv/videos/1)\nça va"), "Salut rediff https://twitch.tv/videos/1 ça va");
  assert.ok(toChat("a".repeat(1000)).length <= 480);
});

test("formatSchedule ignore les lives annulés et passés", () => {
  const future = new Date(Date.now() + 86400_000).toISOString();
  const past = new Date(Date.now() - 86400_000).toISOString();
  const out = formatSchedule(
    [
      { id: "1", start_time: future, end_time: null, title: "Elden Ring", canceled_until: null, category: null, is_recurring: true },
      { id: "2", start_time: future, end_time: null, title: "Annulé", canceled_until: future, category: null, is_recurring: false },
      { id: "3", start_time: past, end_time: past, title: "Vieux", canceled_until: null, category: null, is_recurring: false },
    ],
    null,
  );
  assert.match(out, /Elden Ring/);
  assert.doesNotMatch(out, /Annulé|Vieux/);
});
