import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoBody, buildVideoUpdate, clampSeconds, clampTitle } from '../src/shorts.js';

test('short metadata is vertical-post ready', () => {
  const body = buildVideoBody({
    title: '  Rain on the kettle  ',
    description: 'A quiet counter.',
    tags: ['#rain', 'rain', 'kettle'],
    privacyStatus: 'nope',
    madeForKids: false,
  });
  assert.equal(body.snippet.title, 'Rain on the kettle');
  assert.match(body.snippet.description, /#Shorts/);
  assert.equal(body.snippet.description.includes('#Shorts\n'), false);
  assert.deepEqual(body.snippet.tags.slice(0, 3), ['Shorts', 'rain', 'kettle']);
  assert.equal(body.status.privacyStatus, 'unlisted');
  assert.equal(body.status.selfDeclaredMadeForKids, false);
  assert.equal(body.snippet.categoryId, '22');
});

test('does not duplicate an existing shorts tag', () => {
  const body = buildVideoBody({
    title: 'Already tagged',
    description: 'Watch this #Shorts',
    tags: 'shorts, morning',
    privacyStatus: 'public',
  });
  assert.equal(body.snippet.description, 'Watch this #Shorts');
  assert.equal(body.status.privacyStatus, 'public');
  assert.equal(body.snippet.tags.filter((tag) => tag.toLowerCase() === 'shorts').length, 1);
});

test('an edit keeps fields that were not changed', () => {
  const { parts, body } = buildVideoUpdate({
    id: 'abcdefghijk',
    snippet: {
      title: 'Old title',
      description: 'Keep this',
      tags: ['rain'],
      categoryId: '22',
      defaultLanguage: 'en',
    },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, embeddable: true },
  }, { title: 'New title' });
  assert.deepEqual(parts, ['snippet']);
  assert.equal(body.snippet.title, 'New title');
  assert.equal(body.snippet.description, 'Keep this');
  assert.deepEqual(body.snippet.tags, ['rain']);
  assert.equal(body.snippet.defaultLanguage, 'en');
  assert.equal(body.status, undefined);
});

test('privacy edit does not rewrite the title', () => {
  const { parts, body } = buildVideoUpdate({
    id: 'abcdefghijk',
    snippet: { title: 'Stay', description: 'Stay', tags: [] },
    status: { privacyStatus: 'private', selfDeclaredMadeForKids: true },
  }, { privacyStatus: 'unlisted' });
  assert.deepEqual(parts, ['status']);
  assert.equal(body.status.privacyStatus, 'unlisted');
  assert.equal(body.status.selfDeclaredMadeForKids, true);
  assert.equal(body.snippet, undefined);
  assert.throws(() => buildVideoUpdate({ id: 'abcdefghijk', snippet: {}, status: {} }, {}), /Say what to change/);
  assert.throws(() => buildVideoUpdate({ id: 'abcdefghijk', snippet: {}, status: {} }, { privacyStatus: 'friends' }), /Privacy/);
});

test('title stays within 100 characters', () => {
  assert.equal(clampTitle(''), 'Short');
  assert.equal(clampTitle('a'.repeat(140)).length, 100);
});

test('video duration stays inside 1 to 15 seconds', () => {
  assert.equal(clampSeconds(undefined), 8);
  assert.equal(clampSeconds(0), 1);
  assert.equal(clampSeconds(12.4), 12);
  assert.equal(clampSeconds(40), 15);
});
