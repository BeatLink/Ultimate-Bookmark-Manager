// Sets the icon shown on the add-on's addons.mozilla.org listing, which is stored there and is never read from manifest.json.

import { readFile } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';

const ICON_PATH = 'icons/icon-128.png';
const API = 'https://addons.mozilla.org/api/v5/addons/addon';

// AMO accepts a JWT that is signed with the API secret and expires within five minutes.
function makeToken(issuer, secret) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const issuedAt = Math.floor(Date.now() / 1000);
  const head = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode({ iss: issuer, jti: randomUUID(), iat: issuedAt, exp: issuedAt + 120 });
  const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}

const issuer = process.env.AMO_JWT_ISSUER;
const secret = process.env.AMO_JWT_SECRET;
if (!issuer || !secret) {
  console.error('Set AMO_JWT_ISSUER and AMO_JWT_SECRET to your addons.mozilla.org API credentials');
  process.exit(1);
}

const { browser_specific_settings: settings } = JSON.parse(await readFile('manifest.json', 'utf8'));
const guid = settings.gecko.id;

// The icon has to go up as form data, because the API takes the file itself rather than a JSON field.
const form = new FormData();
form.set('icon', new Blob([await readFile(ICON_PATH)], { type: 'image/png' }), 'icon-128.png');

const response = await fetch(`${API}/${encodeURIComponent(guid)}/`, {
  method: 'PATCH',
  headers: { Authorization: `JWT ${makeToken(issuer, secret)}` },
  body: form,
});

const text = await response.text();
if (!response.ok) {
  console.error(`addons.mozilla.org refused the icon (HTTP ${response.status}): ${text}`);
  process.exit(1);
}

// Mozilla resizes the icon in the background, so the listing can take a few minutes to show it.
console.log(`Uploaded ${ICON_PATH} for ${guid}. Sizes now on record:`);
console.log(JSON.parse(text).icons);
