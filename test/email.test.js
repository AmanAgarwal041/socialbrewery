import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'socialbrewery-email-'));
process.env.SOCIALBREWERY_HOME = temp;
process.env.APP_URL = 'https://brew.example.com';

const email = await import('../src/email.js');
const accounts = await import('../src/accounts.js');
const { runWithOrg } = await import('../src/context.js');
const { ensureData } = await import('../src/store.js');
await ensureData();

const SETTINGS = { RESEND_API_KEY: 're_test', EMAIL_FROM: 'Ada at Acme <hello@acme.com>', EMAIL_POSTAL_ADDRESS: '1 Main St, Springfield', EMAIL_REPLY_TO: 'ada@acme.com' };
async function inNewOrg(config, fn) {
  const org = await accounts.createOrg({ name: 'Acme', config });
  return runWithOrg({ org: { id: org.id, name: org.name }, config: await accounts.loadOrgConfig(org.id), user: null, role: 'admin' }, () => fn(org));
}

function mockResend(handler = () => null) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    assert.equal(u.origin, 'https://api.resend.com');
    const body = JSON.parse(init.body);
    calls.push({ path: u.pathname, headers: init.headers, body });
    const custom = handler(calls.length, body, u.pathname);
    if (custom) return custom;
    const data = Array.isArray(body) ? { data: body.map((_, i) => ({ id: `em_${calls.length}_${i}` })) } : { id: 'em_single' };
    return new Response(JSON.stringify(data), { status: 200 });
  };
  return calls;
}

test('CSV parsing copes with quotes, embedded commas and newlines, BOMs, and semicolons', () => {
  const rows = email.parseCsv('﻿Email,Name,Company\r\n"ada@x.com","Lovelace, Ada","Analytical ""Engines"""\r\nbob@x.com,Bob,"Line one\nline two"\n\n');
  assert.deepEqual(rows, [
    ['Email', 'Name', 'Company'],
    ['ada@x.com', 'Lovelace, Ada', 'Analytical "Engines"'],
    ['bob@x.com', 'Bob', 'Line one\nline two'],
  ]);
  assert.deepEqual(email.parseCsv('email;first_name\nc@x.com;Cy'), [['email', 'first_name'], ['c@x.com', 'Cy']]);
  assert.deepEqual(email.mapColumns(['E-mail', 'First Name', 'Surname', 'Organisation', 'Tags']), { email: 0, firstName: 1, lastName: 2, company: 3, tags: 4 });
});

test('importing needs consent, dedupes, and never resubscribes someone who opted out', async () => {
  await inNewOrg(SETTINGS, async () => {
    await assert.rejects(email.importLeads({ csv: 'email\na@x.com', consent: false }), /agreed to receive/);
    await assert.rejects(email.importLeads({ csv: 'name\nAda', consent: true }), /email column/);

    const first = await email.importLeads({ csv: 'email,full name,company,tags\nADA@x.com,Ada Lovelace,Engines,vip;beta\nnot-an-email,Nope,,\nada@x.com,,,', consent: true, tags: 'launch' });
    assert.equal(first.added, 1);
    assert.equal(first.updated, 1, 'the second ada row merges into the first');
    assert.deepEqual(first.skipped, [{ line: 3, reason: 'No valid email address' }]);
    const [ada] = await email.listLeads();
    assert.equal(ada.email, 'ada@x.com');
    assert.equal(ada.firstName, 'Ada');
    assert.equal(ada.lastName, 'Lovelace');
    assert.deepEqual(ada.tags, ['vip', 'beta', 'launch']);

    assert.equal(await email.unsubscribeLead(ada.id), true);
    await email.deleteLeads([ada.id]);
    await email.importLeads({ csv: 'email\nada@x.com', consent: true });
    assert.equal((await email.listLeads())[0].status, 'unsubscribed', 'suppression outlives deleting the lead');
    await email.addLead({ email: 'new@x.com', firstName: 'New' });
    await assert.rejects(email.addLead({ email: 'new@x.com' }), /already a lead/);
  });
});

test('emails merge fields, escape HTML, and always carry the address and unsubscribe link', async () => {
  await inNewOrg(SETTINGS, async (org) => {
    const lead = { id: 'a'.repeat(16), email: 'ada@x.com', firstName: '', company: '<Engines>' };
    const rendered = email.renderEmail({ subject: 'Hi {{first_name|there}}', body: 'Hello {{first_name|there}} at {{company}}.\n\n**Bold** <script>x</script> [docs](https://acme.com/docs)' }, lead);
    assert.equal(rendered.subject, 'Hi there');
    assert.match(rendered.html, /Hello there at &lt;Engines&gt;\./);
    assert.match(rendered.html, /<strong>Bold<\/strong> &lt;script&gt;x&lt;\/script&gt; <a href="https:\/\/acme.com\/docs">docs<\/a>/);
    assert.doesNotMatch(rendered.html, /<script>/);
    assert.match(rendered.html, /1 Main St, Springfield/);
    const unsubscribe = `https://brew.example.com/public/unsubscribe/${org.id}/${lead.id}?sig=`;
    assert.ok(rendered.html.includes(unsubscribe));
    assert.ok(rendered.text.includes(unsubscribe));
    assert.equal(rendered.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    const sig = new URL(rendered.headers['List-Unsubscribe'].slice(1, -1)).searchParams.get('sig');
    assert.equal(email.verifyUnsubscribe(org.id, lead.id, sig), true);
    assert.equal(email.verifyUnsubscribe(org.id, 'b'.repeat(16), sig), false);
  });
});

test('CSV extra columns become lead meta and work as merge fields; empty subjects are blocked', async () => {
  assert.equal(email.metaKey('Company Size'), 'company_size');
  assert.equal(email.metaKey('  SUBJECT '), 'subject');
  assert.deepEqual(email.mapMetaColumns(['email', 'Subject', 'body', 'Custom Note', 'company']), {
    subject: 1,
    body: 2,
    custom_note: 3,
  });

  await inNewOrg(SETTINGS, async () => {
    const imported = await email.importLeads({
      csv: 'email,subject,body,custom_note,company\nada@x.com,Hello Ada,Line one for Ada,note-a,Engines\nbob@x.com,Hello Bob,Line one for Bob,note-b,Analytical',
      consent: true,
    });
    assert.equal(imported.added, 2);
    const leads = await email.listLeads();
    const ada = leads.find((l) => l.email === 'ada@x.com');
    assert.deepEqual(ada.meta, { subject: 'Hello Ada', body: 'Line one for Ada', custom_note: 'note-a' });
    assert.equal(ada.company, 'Engines');

    const rendered = email.renderEmail(
      { subject: '{{subject}}', body: '{{body}}\n{{custom_note}}\nHi {{first_name|there}}' },
      ada,
    );
    assert.equal(rendered.subject, 'Hello Ada');
    assert.match(rendered.text, /^Line one for Ada\nnote-a\nHi there/);

    // Core fields win over a colliding meta key; unknown tags stay as written.
    assert.equal(email.merge('{{company}}|{{typo_field}}', { company: 'Core', meta: { company: 'Meta' } }), 'Core|{{typo_field}}');
    assert.equal(email.merge('{{missing}}', {}), '{{missing}}');
    assert.equal(email.merge('{{first_name|pal}}', { firstName: '' }), 'pal');

    // Re-import refreshes meta for columns in this CSV (blank overwrites that key).
    await email.importLeads({
      csv: 'email,subject,body\nada@x.com,Updated subject,\n',
      consent: true,
    });
    const [again] = (await email.listLeads()).filter((l) => l.email === 'ada@x.com');
    assert.equal(again.meta.subject, 'Updated subject');
    assert.equal(again.meta.body, '', 'blank cell refreshes the key to empty');
    assert.equal(again.meta.custom_note, 'note-a', 'columns absent from this CSV are left alone');

    const manual = await email.addLead({ email: 'manual@x.com', firstName: 'Mo', meta: { subject: 'From API', offer: '20%' } });
    assert.deepEqual(manual.meta, { subject: 'From API', offer: '20%' });
    assert.equal(email.merge('{{subject}} {{offer}}', manual), 'From API 20%');

    // Subject that resolves to empty with a blank lead is refused before send (and would hang some SMTP servers).
    const emptySubject = await email.saveCampaign('', { subject: '{{first_name}}', body: 'Hi' });
    await assert.rejects(email.sendCampaignChunk(emptySubject.id), /Subject is empty after merge|CSV column/);
    await assert.rejects(email.sendTest(emptySubject.id, 'me@acme.com'), /Subject is empty after merge|CSV column/);

    // {{subject}} stays as written on a blank sample, so assertReady allows it; a lead with an empty
    // subject meta key fails that address only (known empty field → "").
    const perLead = await email.saveCampaign('', { subject: '{{subject}}', body: '{{body|Hi}}' });
    await email.addLead({ email: 'nosub@x.com', meta: { subject: '', body: 'No subject lead' } });
    const calls = mockResend();
    const result = await email.sendCampaignChunk(perLead.id);
    assert.ok(result.sentNow >= 2, 'leads with subject meta still send');
    assert.ok(calls.length >= 1);
    assert.ok(calls.some((c) => (Array.isArray(c.body) ? c.body : [c.body]).some((m) => m.subject === 'Hello Bob' || m.subject === 'Updated subject')));
    const details = await email.campaignDetails(perLead.id);
    assert.ok(details.failures.some((f) => f.email === 'nosub@x.com' && /empty after merge/i.test(f.error)));
  });
});

test('campaigns send in batches of 100 to subscribed leads in the audience, once each', async () => {
  await inNewOrg(SETTINGS, async () => {
    const rows = Array.from({ length: 250 }, (_, i) => `lead${i}@x.com,${i % 2 ? 'vip' : 'other'}`).join('\n');
    await email.importLeads({ csv: `email,tags\n${rows}\nout@x.com,vip`, consent: true });
    const out = (await email.listLeads()).find((l) => l.email === 'out@x.com');
    await email.unsubscribeLead(out.id);

    const campaign = await email.saveCampaign('', { name: 'Launch', subject: 'News for {{first_name|you}}', body: 'Hi {{first_name|there}}', audienceTags: ['vip'] });
    const calls = mockResend();
    const result = await email.sendCampaignChunk(campaign.id);
    assert.equal(result.status, 'sent');
    assert.equal(result.sentNow, 125);
    assert.deepEqual(calls.map((c) => c.body.length), [100, 25]);
    assert.equal(calls[0].headers['User-Agent'], 'socialbrewery');
    assert.equal(calls[0].headers.Authorization, 'Bearer re_test');
    assert.match(calls[0].headers['Idempotency-Key'], /^sb-[a-f0-9]{16}-[a-f0-9]{32}$/);
    const first = calls[0].body[0];
    assert.equal(first.from, 'Ada at Acme <hello@acme.com>');
    assert.equal(first.reply_to, 'ada@acme.com');
    assert.equal(first.to.length, 1);
    assert.ok(first.headers['List-Unsubscribe']);
    const recipients = calls.flatMap((c) => c.body.map((m) => m.to[0]));
    assert.equal(recipients.includes('out@x.com'), false, 'unsubscribed leads are skipped');
    assert.equal(recipients.some((r) => /lead\d*[02468]@/.test(r)), false, 'only the vip audience');

    // Sending again doesn't mail anyone twice.
    const again = mockResend();
    assert.equal((await email.sendCampaignChunk(campaign.id)).sentNow, 0);
    assert.equal(again.length, 0);
    await assert.rejects(email.saveCampaign(campaign.id, { subject: 'changed' }), /can’t be edited/);
  });
});

test('a failed batch is kept for a retry, and a bad key stops the send', async () => {
  await inNewOrg(SETTINGS, async () => {
    await email.importLeads({ csv: 'email\na@x.com\nb@x.com', consent: true });
    const campaign = await email.saveCampaign('', { subject: 'S', body: 'B' });
    mockResend(() => new Response(JSON.stringify({ message: 'Invalid `to` field.' }), { status: 422 }));
    const failed = await email.sendCampaignChunk(campaign.id);
    assert.equal(failed.failedNow, 2);
    assert.equal((await email.campaignDetails(campaign.id)).failures.length, 2);
    assert.deepEqual(await email.retryFailed(campaign.id), { cleared: 2 });
    mockResend();
    assert.equal((await email.sendCampaignChunk(campaign.id)).sentNow, 2);

    const other = await email.saveCampaign('', { subject: 'S', body: 'B' });
    mockResend(() => new Response(JSON.stringify({ message: 'API key is invalid' }), { status: 401 }));
    await assert.rejects(email.sendCampaignChunk(other.id), /API key is invalid/);
    assert.equal((await email.getCampaign(other.id)).status, 'paused');
  });
  await inNewOrg({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'a@b.com' }, async () => {
    await email.addLead({ email: 'x@x.com' });
    const campaign = await email.saveCampaign('', { subject: 'S', body: 'B' });
    await assert.rejects(email.sendCampaignChunk(campaign.id), /Postal address/);
  });
});

test('test sends go to one address and never carry a real lead’s unsubscribe link', async () => {
  await inNewOrg(SETTINGS, async () => {
    const lead = await email.addLead({ email: 'real@x.com', firstName: 'Real' });
    const campaign = await email.saveCampaign('', { subject: 'Hi {{first_name}}', body: 'Hello {{first_name}}' });
    const calls = mockResend();
    assert.deepEqual(await email.sendTest(campaign.id, 'me@acme.com'), { id: 'em_single', to: 'me@acme.com' });
    assert.equal(calls[0].path, '/emails');
    assert.deepEqual(calls[0].body.to, ['me@acme.com']);
    assert.equal(calls[0].body.subject, '[Test] Hi Real');
    assert.equal(calls[0].body.html.includes(lead.id), false);
  });
});

test('Resend webhooks are verified, and bounces and complaints suppress the address', async () => {
  const secret = `whsec_${Buffer.from('super-secret-key').toString('base64')}`;
  const raw = JSON.stringify({ type: 'email.bounced', data: { to: ['bounce@x.com'], bounce: { type: 'Permanent' } } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', Buffer.from('super-secret-key')).update(`msg_1.${ts}.${raw}`).digest('base64');
  const headers = { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': `v1,wrong v1,${sig}` };
  assert.equal(email.verifyResendWebhook(headers, raw, secret), true);
  assert.equal(email.verifyResendWebhook(headers, `${raw} `, secret), false);
  assert.equal(email.verifyResendWebhook({ ...headers, 'svix-timestamp': String(Number(ts) - 3600) }, raw, secret), false);

  await inNewOrg(SETTINGS, async () => {
    await email.importLeads({ csv: 'email\nbounce@x.com\nspam@x.com\nsoft@x.com', consent: true });
    assert.equal(await email.applyResendEvent(JSON.parse(raw)), 1);
    assert.equal(await email.applyResendEvent({ type: 'email.complained', data: { to: ['spam@x.com'] } }), 1);
    assert.equal(await email.applyResendEvent({ type: 'email.bounced', data: { to: ['soft@x.com'], bounce: { type: 'Transient' } } }), 0);
    const status = Object.fromEntries((await email.listLeads()).map((l) => [l.email, l.status]));
    assert.deepEqual(status, { 'bounce@x.com': 'bounced', 'spam@x.com': 'unsubscribed', 'soft@x.com': 'subscribed' });
  });
});

test('drafts from the assistant are parsed from JSON, even inside a code fence', () => {
  assert.deepEqual(email.parseDraft('```json\n{"subject":"Hi","body":"Hello {{first_name|there}}"}\n```'), { subject: 'Hi', body: 'Hello {{first_name|there}}' });
  assert.throws(() => email.parseDraft('Sure! Here you go.'), /usable draft/);
});

test.after(() => fs.rm(temp, { recursive: true, force: true }));
