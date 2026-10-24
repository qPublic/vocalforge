// Builds engine/build/engine.exe by running engine/build.bat (Visual Studio C++ tools required).
const { spawnSync } = require('child_process');
const path = require('path');

const bat = path.join(__dirname, '..', 'engine', 'build.bat');
const result = spawnSync('cmd.exe', ['/d', '/c', bat], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
