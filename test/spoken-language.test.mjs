/* The rule: the language is SET, not guessed — and a tag that would be quietly
 * replaced is reported rather than replaced in silence.
 *
 * Guessing wrote "search Google for best pizza" down as "Сочет Google Best
 * Pizza in the". The model acts on that text, so the errand went somewhere
 * else, and the person cannot read a transcript to find out why.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { of, usable, offered, nameOf, DEFAULT } = loadShared('spoken-language.js', 'SpokenLanguage');

test('English is the default, because the demo and the sites are English', () => {
  assert.equal(DEFAULT, 'en');
  assert.equal(of(undefined), 'en');
  assert.equal(of(''), 'en');
  assert.equal(of('   '), 'en');
});

test('a tag is taken as written', () => {
  assert.equal(of('ru'), 'ru');
  assert.equal(of('pt-BR'), 'pt-BR');
});

test('the case somebody types it in is not a refusal', () => {
  // Pedantry here is aimed at the one person setting this up for somebody else.
  assert.equal(of('EN'), 'en');
  assert.equal(of('en-us'), 'en-US');
  assert.equal(of(' Ru '), 'ru');
});

test('anything not shaped like a language falls back to one that works', () => {
  // The session would answer an invalid tag with an error nobody in the room
  // could read.
  for (const junk of ['english', 'e', 'en_US', 'en-USA', '12', 'en-US-x', 42, null, {}]) {
    assert.equal(of(junk), 'en', JSON.stringify(junk) ?? String(junk));
  }
});

test('anything past a region is kept, so it fails rather than being trimmed', () => {
  // 'en-US-x' was tidied into 'en-US' and accepted, which is the machine
  // deciding it knew what somebody meant.
  assert.equal(usable('en-US-x'), false);
});

test('usable says what will happen before it happens', () => {
  assert.equal(usable('ru'), true);
  assert.equal(usable('pt-BR'), true);
  assert.equal(usable(''), true, 'nothing at all is usable: it means the default');
  assert.equal(usable(undefined), true);
  assert.equal(usable('english'), false, 'a name is not a tag');
});

test('the settings page has a handful to offer, and a name for each', () => {
  const list = offered();
  assert.ok(list.length >= 4);
  assert.ok(list.every((one) => usable(one.tag) && one.name));
  assert.equal(nameOf('ru'), 'Russian');
});

test('a tag nobody offered is still said back as itself', () => {
  assert.equal(nameOf('pt-BR'), 'pt-BR');
});

test('editing what the page was handed does not edit the list', () => {
  const list = offered();
  list[0].name = 'Klingon';
  assert.equal(offered()[0].name, 'English');
});
