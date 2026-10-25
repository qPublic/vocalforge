// Tracks which program has focus and whether the mouse cursor is hidden, so global hotkeys can step aside
// when a game is not the active window, or its cursor is showing (chat, menus, shop).
// Windows only. A PowerShell process polls and prints "name|hidden" whenever either changes.
const { spawn } = require('child_process');

const DEFAULT_GAMES = Object.freeze([
  'VALORANT-Win64-Shipping.exe',
  'cs2.exe',
  'FortniteClient-Win64-Shipping.exe',
  'r5apex.exe',
  'Overwatch.exe',
  'RainbowSix.exe',
  'LeagueOfLegends.exe',
  'GTA5.exe',
  'RustClient.exe',
  'destiny2.exe',
]);
const MAX_GAMES = 50;

// Keep only plausible executable names. They are only ever compared against process names.
function sanitizeGames(list) {
  if (!Array.isArray(list)) return [...DEFAULT_GAMES];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (!/^[\w .()\-]{1,64}\.exe$/i.test(name) || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length >= MAX_GAMES) break;
  }
  return out;
}

function isGame(processName, games) {
  if (typeof processName !== 'string' || !processName) return false;
  const lower = processName.toLowerCase();
  return games.some((g) => g.toLowerCase() === lower);
}

// Process names come from the process list rather than opening the process, because anti-cheat drivers
// can refuse handles to a game they protect.
const SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class FG {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static uint Pid() { uint p; GetWindowThreadProcessId(GetForegroundWindow(), out p); return p; }
  [StructLayout(LayoutKind.Sequential)] struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public int x; public int y; }
  [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO ci);
  public static bool Hidden() { CURSORINFO ci = new CURSORINFO(); ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO)); return GetCursorInfo(ref ci) && (ci.flags & 1) == 0; }
}
"@
$last = $null
while ($true) {
  $name = ''
  try { $name = [System.Diagnostics.Process]::GetProcessById([FG]::Pid()).ProcessName + '.exe' } catch {}
  $line = $name + '|' + $(if ([FG]::Hidden()) { '1' } else { '0' })
  if ($line -ne $last) { $last = $line; [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
  Start-Sleep -Milliseconds 250
}
`;

// "VALORANT-Win64-Shipping.exe|1" -> { name, cursorHidden: true }. A bare name counts as cursor showing.
function parseLine(line) {
  const [name = '', flag = '0'] = String(line).trim().split('|');
  return { name, cursorHidden: flag === '1' };
}

// Calls onChange({ name, cursorHidden }) whenever the focused program or the cursor state changes. Returns { stop }.
function watch(onChange, spawnFn = spawn) {
  if (process.platform !== 'win32') return { stop() {} };
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  const child = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      onChange(parseLine(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  child.on('error', () => {});
  return { stop: () => child.kill() };
}

module.exports = { DEFAULT_GAMES, sanitizeGames, isGame, parseLine, watch };
