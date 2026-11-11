import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const pkg = JSON.parse(read('package.json'));
const source = read('src-tauri/src/backend.rs');
const cleaner = read('src-tauri/src/cleanup.rs');
const app = read('src/App.tsx');
const css = read('src/styles.css');
const model = read('src/model.ts');
const taskCatalog = read('shared/tasks.json');
const i18n = read('src/i18n.ts');

test('Tauri 2 and actual React Activity Rings are used', () => {
  assert.match(pkg.dependencies['@jonasdoesthings/react-activity-rings'], /^1\.2\.0$/);
  assert.match(pkg.dependencies.react, /^18\./);
  assert.match(app, /import\s*\{\s*ActivityRings\s*\}/);
  assert.match(app, /<ActivityRings\s/);
  assert.equal(config.version, '2.0.10');
  assert.equal(config.bundle.targets[0], 'nsis');
});

test('Installer and interface cover PT-BR, EN-GB, ES, RU and Simplified Chinese', () => {
  assert.deepEqual(config.bundle.windows.nsis.languages,
    ['PortugueseBR', 'English', 'Spanish', 'Russian', 'SimpChinese']);
  assert.equal(config.bundle.windows.nsis.displayLanguageSelector, true);
  assert.equal(config.bundle.licenseFile, 'INSTALL_TERMS.txt');
  const terms = read('src-tauri/INSTALL_TERMS.txt');
  for (const header of ['PORTUGUÊS (BRASIL)', 'ENGLISH (UNITED KINGDOM)', 'ESPAÑOL', 'РУССКИЙ', '简体中文']) {
    assert.ok(terms.includes(header));
  }
  for (const language of ['pt', 'en', 'es', 'ru', 'zh']) {
    assert.match(i18n, new RegExp(`\\n  ${language}: \\{`));
    assert.match(app, new RegExp(`value="${language}"`));
  }
});

test('CHKDSK only accepts validated system-discovered drives', () => {
  assert.match(source, /DriveType=3/);
  assert.match(source, /fn valid_letter\(/);
  assert.match(source, /selected_drives\(&request\.disk_target\)/);
  assert.match(source, /request\.repair_acknowledged/);
  assert.match(taskCatalog, /"chkdsk-f"/);
  assert.match(app, /value="all"/);
  assert.match(app, /repairConfirmed/);
});

test('Commands run in hidden native process and with a fixed allowlist', () => {
  assert.match(source, /CREATE_NO_WINDOW/);
  assert.match(source, /fn known_task\(/);
  for (const operation of ['dism-check', 'sfc', 'cleanmgr-run', 'flushdns',
                           'renewip', 'winget-upgrade', 'rammap-empty']) {
    assert.ok(source.includes(`"${operation}"`));
  }
  assert.match(source, /stop_after_current/);
});

test('Eight new cleaners are individually selectable and safely constrained', () => {
  for (const id of ['temp-user', 'temp-windows', 'thumbcache-user',
    'browser-edge', 'browser-firefox', 'browser-vivaldi', 'browser-brave', 'browser-chrome']) {
    assert.ok(taskCatalog.includes(`"id":"${id}"`), `UI task ${id}`);
    assert.ok(cleaner.includes(`"${id}"`), `backend cleanup ${id}`);
    assert.ok(i18n.includes(`'${id}':`), `translation ${id}`);
  }
  assert.match(source, /crate::cleanup::run\(/);
  assert.match(cleaner, /validate_ancestors/);
  assert.match(cleaner, /is_reparse/);
  assert.match(cleaner, /browser_running/);
  assert.doesNotMatch(cleaner, /Command::new\(["'](?:taskkill|takeown|icacls)/);
  assert.doesNotMatch(cleaner, /\.join\(["'](?:Storage|Service Worker)["']\)/);
});

test('Responsive themes have animated aura and reduced-motion fallback', () => {
  assert.ok(css.includes("data-theme='light'"));
  assert.match(css, /:root\s*\{/);
  assert.match(css, /@keyframes aura-/);
  assert.match(css, /backdrop-filter: blur/);
  assert.match(css, /max-width: 760px/);
  assert.match(css, /prefers-reduced-motion/);
});

test('Necessary build icons and UTF-8 documents are present', () => {
  for (const name of ['src-tauri/icons/icon.ico', 'src-tauri/icons/32x32.png',
                      'src-tauri/icons/128x128.png', 'README.md']) {
    assert.ok(existsSync(new URL(name, root)), name);
  }
  assert.ok(i18n.includes('Português'));
  assert.ok(i18n.includes('Español'));
  assert.ok(i18n.includes('Русский'));
});

test('Updates, tray behaviour and project support stay explicit and constrained', () => {
  assert.match(app, /api\.github\.com\/repos\/RaphaelTW\/WinCleam\/releases\/latest/);
  assert.match(app, /availableRelease/);
  assert.match(app, /Apoie via PIX/);
  assert.match(source, /fn open_latest_release\(\)/);
  assert.match(source, /https:\/\/github\.com\/RaphaelTW\/WinCleam\/releases\/latest/);
  assert.match(source, /fn setup_tray\(/);
  assert.match(source, /WindowEvent::CloseRequested/);
  assert.match(config.app.security.csp, /https:\/\/api\.github\.com/);
});
