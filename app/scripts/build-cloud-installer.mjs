import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

// Stream full diagnostics, retaining only the tail for failure classification.
function runTauri(args) {
    const tauriCli = fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url));
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [tauriCli, ...args], { stdio: ['inherit', 'pipe', 'pipe'] });
        let output = '';
        for (const [source, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
            source.setEncoding('utf8');
            source.on('data', text => {
                destination.write(text);
                output = (output + text).slice(-65_536);
            });
        }
        child.on('error', reject);
        child.on('close', code => resolve({ code: code ?? 1, output }));
    });
}

export async function buildCloudInstaller({ target, bundles, publish, run = runTauri, sleep: wait = sleep, log = console.log }) {
    if (!target || !bundles) throw new Error('Expected target and bundles');
    if (publish && !process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('Missing updater signing secret');
    const args = ['--verbose', '--target', target, '--bundles', bundles];
    if (!publish) args.push('--config', '{"bundle":{"createUpdaterArtifacts":false}}');
    let result = await run(['build', ...args]);
    const canRetryDmg = target.endsWith('-apple-darwin') && bundles.split(',').includes('dmg');
    // The original failure occurred after compilation and app signing. Reuse the
    // compiled executable; do not retry compilation, signing or updater errors.
    for (let retry = 1; retry <= 2 && result.code !== 0; retry++) {
        if (!canRetryDmg || !result.output.includes('error running bundle_dmg.sh')) break;
        log(`DMG script failed; retrying packaging ${retry}/2 after ${retry * 10}s (compiled executable reused)`);
        await wait(retry * 10_000);
        result = await run(['bundle', ...args]);
    }
    return result.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const publish = process.env.RELEASE_PUBLISH;
        if (publish !== 'true' && publish !== 'false') throw new Error('RELEASE_PUBLISH must be true or false');
        process.exitCode = await buildCloudInstaller({ target: process.argv[2], bundles: process.argv[3], publish: publish === 'true' });
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
