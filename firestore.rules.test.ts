import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesText = fs.readFileSync(rulesPath, 'utf8');

test('firestore.rules enforces default-deny, email_verified, Master Gate, and strict schema validation', () => {
  assert.match(rulesText, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
  assert.match(rulesText, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesText, /allow list: if false;/);
  assert.match(rulesText, /allow update: if false;/);
  assert.match(rulesText, /isValidUserMemoryProfile\(incoming\(\), userId\)/);
  assert.match(rulesText, /isValidFavoriteTrack\(incoming\(\), userId, trackKey\)/);
  assert.match(rulesText, /isValidFitnessSession\(incoming\(\), userId\)/);
  assert.match(rulesText, /exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(userId\)\)/);
  assert.match(rulesText, /allow list: if isOwner\(userId\) && existing\(\)\.uid == request\.auth\.uid;/);
});
