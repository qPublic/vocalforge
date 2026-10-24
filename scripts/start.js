// Launch Electron with ELECTRON_RUN_AS_NODE cleared (VS Code terminals can set it,
// which makes electron run as plain Node and crash on require('electron')).
const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

spawn(electron, ['.'], { stdio: 'inherit', env }).on('exit', (code) => process.exit(code ?? 0));
