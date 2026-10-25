// Builds engine/build/engine.exe by running engine/build.bat (Visual Studio C++ tools required).
const { spawnSync } = require('child_process');
const path = require('path');

// The RNNoise model is too big for git, so fetch it first (a no-op once it is there).
const fetchModel = spawnSync(process.execPath, [path.join(__dirname, 'fetch-rnnoise-model.js')], { stdio: 'inherit' });
if (fetchModel.status !== 0) process.exit(fetchModel.status === null ? 1 : fetchModel.status);

const bat = path.join(__dirname, '..', 'engine', 'build.bat');
const result = spawnSync('cmd.exe', ['/d', '/c', bat], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
