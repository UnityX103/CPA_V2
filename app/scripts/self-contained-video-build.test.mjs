import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
    assertMacMinimumSystemVersionCompatible,
    assertRelocatableMacDependencyMetadata,
    assertReleaseBuildArguments,
    hostCanRunTarget,
    macMinimumSystemVersionFromLoadCommands,
    macAppBundlePath,
    resolveTauriTargetTriple,
    runtimeTargetForTauriTriple,
} from './self-contained-video-build.mjs';
import { hostCanRunRuntimeTarget } from './prepare-video-runtime.mjs';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoots = [];

function macDependencyFixture() {
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'cpa-mac-deps-'));
    tempRoots.push(runtimeRoot);
    const binaryPath = join(runtimeRoot, 'backgroundremover', 'backgroundremover');
    const internalRoot = join(runtimeRoot, 'backgroundremover', '_internal');
    mkdirSync(internalRoot, { recursive: true });
    writeFileSync(binaryPath, 'worker');
    for (const name of ['Python', 'libtorch_cpu.dylib']) {
        writeFileSync(join(internalRoot, name), name);
    }
    return {
        runtimeRoot,
        binaryPath,
        executablePaths: [binaryPath],
        availableFiles: [
            binaryPath,
            join(internalRoot, 'Python'),
            join(internalRoot, 'libtorch_cpu.dylib'),
        ],
    };
}

describe('self-contained video build target selection', () => {
    afterEach(() => {
        while (tempRoots.length) rmSync(tempRoots.pop(), { recursive: true, force: true });
    });
    it.each([
        ['x86_64-apple-darwin', 'macos-x86_64'],
        ['aarch64-apple-darwin', 'macos-arm64'],
        ['x86_64-pc-windows-msvc', 'windows-x86_64'],
    ])('maps Tauri target %s to runtime payload %s', (triple, runtimeTarget) => {
        expect(runtimeTargetForTauriTriple(triple)).toBe(runtimeTarget);
    });

    it('rejects a target that has no bundled runtime contract', () => {
        expect(() => runtimeTargetForTauriTriple('armv7-unknown-linux-gnueabihf'))
            .toThrow(/unsupported self-contained video build target/i);
        expect(() => runtimeTargetForTauriTriple('aarch64-pc-windows-msvc'))
            .toThrow(/unsupported self-contained video build target/i);
    });

    it('uses the explicit target instead of the build host architecture', () => {
        expect(resolveTauriTargetTriple(
            ['--target', 'x86_64-apple-darwin'],
            { TAURI_ENV_TARGET_TRIPLE: 'aarch64-apple-darwin' },
        )).toBe('x86_64-apple-darwin');
    });

    it('accepts Tauri\'s short target flag', () => {
        expect(resolveTauriTargetTriple(
            ['-t', 'x86_64-apple-darwin'],
            {},
        )).toBe('x86_64-apple-darwin');
    });

    it('uses Tauri\'s compile target when invoked as a beforeBuildCommand', () => {
        expect(resolveTauriTargetTriple([], {
            TAURI_ENV_TARGET_TRIPLE: 'x86_64-apple-darwin',
        })).toBe('x86_64-apple-darwin');
    });

    it('derives the compile target from the environment variables Tauri exposes to hooks', () => {
        expect(resolveTauriTargetTriple([], {
            TAURI_ENV_PLATFORM: 'darwin',
            TAURI_ENV_ARCH: 'x86_64',
        })).toBe('x86_64-apple-darwin');
        expect(resolveTauriTargetTriple([], {
            TAURI_ENV_PLATFORM: 'windows',
            TAURI_ENV_ARCH: 'x86_64',
        })).toBe('x86_64-pc-windows-msvc');
        expect(resolveTauriTargetTriple([], {
            TAURI_ENV_PLATFORM: 'darwin',
            TAURI_ENV_ARCH: 'arm64',
        })).toBe('aarch64-apple-darwin');
        expect(resolveTauriTargetTriple([], {
            TAURI_ENV_PLATFORM: 'darwin',
            TAURI_ENV_ARCH: 'aarch64',
        })).toBe('aarch64-apple-darwin');
    });

    it('fails closed when neither CLI nor Tauri provides a target triple', () => {
        expect(() => resolveTauriTargetTriple([], {})).toThrow(/target triple is required/i);
    });

    it('gates every Tauri package build on target-specific runtime verification', () => {
        const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
        const tauriConfig = JSON.parse(
            readFileSync(join(appRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'),
        );

        expect(packageJson.scripts['video-runtime:verify-build'])
            .toBe('node scripts/self-contained-video-build.mjs verify');
        expect(packageJson.scripts['build:self-contained'])
            .toBe('node scripts/self-contained-video-build.mjs build');
        expect(tauriConfig.build.beforeBuildCommand)
            .toMatch(/^npm run video-runtime:verify-build && npm run build$/);
        expect(tauriConfig.build.beforeBundleCommand)
            .toBe('npm run video-runtime:verify-build');
    });

    it.each([
        ['x86_64-apple-darwin', 'darwin', 'arm64', true],
        ['x86_64-apple-darwin', 'darwin', 'x64', true],
        ['x86_64-apple-darwin', 'darwin', 'x86_64', true],
        ['x86_64-apple-darwin', 'win32', 'x64', false],
        ['aarch64-apple-darwin', 'darwin', 'arm64', true],
        ['aarch64-apple-darwin', 'darwin', 'aarch64', true],
        ['aarch64-apple-darwin', 'darwin', 'x64', false],
        ['aarch64-apple-darwin', 'darwin', 'x86_64', false],
        ['aarch64-apple-darwin', 'win32', 'arm64', false],
        ['x86_64-pc-windows-msvc', 'win32', 'x64', true],
        ['x86_64-pc-windows-msvc', 'win32', 'x86_64', true],
        ['x86_64-pc-windows-msvc', 'win32', 'arm64', false],
        ['x86_64-pc-windows-msvc', 'darwin', 'arm64', false],
    ])(
        'keeps the %s build smoke gate aligned on %s/%s with result %s',
        (triple, platform, architecture, expected) => {
            const runtimeTarget = runtimeTargetForTauriTriple(triple);
            expect(hostCanRunTarget(triple, platform, architecture)).toBe(expected);
            expect(hostCanRunTarget(triple, platform, architecture))
                .toBe(hostCanRunRuntimeTarget(runtimeTarget, platform, architecture));
        },
    );

    it.each(['x86_64-apple-darwin', 'aarch64-apple-darwin'])(
        'pins %s package verification to its exact release app',
        (triple) => {
            expect(macAppBundlePath('/workspace/app', triple, '桌宠番茄钟'))
                .toBe(join(
                    '/workspace/app',
                    'src-tauri',
                    'target',
                    triple,
                    'release',
                    'bundle',
                    'macos',
                    '桌宠番茄钟.app',
                ));
        },
    );

    it('pins both thin macOS packages to the worker runtime minimum of macOS 14', () => {
        const baseConfig = JSON.parse(readFileSync(
            join(appRoot, 'src-tauri', 'tauri.conf.json'),
            'utf8',
        ));

        expect(baseConfig.bundle.macOS.minimumSystemVersion).toBe('14.0');
    });

    it('rejects debug mode because self-contained package verification is release-only', () => {
        expect(() => assertReleaseBuildArguments(['--debug']))
            .toThrow(/release builds only/i);
    });

    it('requires licenses for the embedded Python runtime and packager', () => {
        const policy = JSON.parse(readFileSync(
            join(appRoot, 'src-tauri', 'video-runtime', 'source-policy.json'),
            'utf8',
        ));

        expect(policy.licenses.requiredFiles).toEqual(expect.arrayContaining([
            'Python-LICENSE.txt',
            'TorchVision-LICENSE.txt',
            'PyInstaller-COPYING.txt',
        ]));
    });

    it('allows both thin macOS architectures while keeping Windows x64-only', () => {
        const policy = JSON.parse(readFileSync(
            join(appRoot, 'src-tauri', 'video-runtime', 'source-policy.json'),
            'utf8',
        ));

        expect(policy.supportedTargets).toEqual([
            'macos-x86_64',
            'macos-arm64',
            'windows-x86_64',
        ]);
    });

    it('accepts only system or relocatable Mach-O dependency references', () => {
        const context = macDependencyFixture();
        const dependencies = `/tmp/backgroundremover:
\t@rpath/Python (compatibility version 3.12.0, current version 3.12.0)
\t@loader_path/_internal/libtorch_cpu.dylib (compatibility version 0.0.0, current version 0.0.0)
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)
\t/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation (compatibility version 150.0.0, current version 3500.0.0)
`;
        const loadCommands = `Load command 12
          cmd LC_RPATH
      cmdsize 48
         path @loader_path/_internal (offset 12)
Load command 13
          cmd LC_RPATH
      cmdsize 32
         path /usr/lib/swift (offset 12)
`;

        expect(() => assertRelocatableMacDependencyMetadata(
            'backgroundremover',
            dependencies,
            loadCommands,
            context,
        )).not.toThrow();
    });

    it('extracts the greatest macOS deployment target from Mach-O load commands', () => {
        const loadCommands = `Load command 7
      cmd LC_ID_DYLIB
  cmdsize 48
     name @rpath/libexample.dylib (offset 24)
compatibility version 14.0.0
current version 14.0.0
Load command 8
      cmd LC_VERSION_MIN_MACOSX
  cmdsize 16
  version 10.13
      sdk 13.3
Load command 9
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform 1
    minos 14.0
      sdk 15.2
   ntools 1
`;

        expect(macMinimumSystemVersionFromLoadCommands(loadCommands, 'worker'))
            .toBe('14.0');
    });

    it('fails closed when a Mach-O file has no macOS deployment target command', () => {
        expect(() => macMinimumSystemVersionFromLoadCommands(
            'Load command 0\n      cmd LC_SEGMENT_64\n',
            'worker/_internal/native.so',
        )).toThrow(/does not declare a macOS minimum system version/i);
    });

    it('rejects a bundle minimum below the greatest embedded Mach-O minimum', () => {
        expect(() => assertMacMinimumSystemVersionCompatible(
            '14.0',
            '13.6.9',
            'video runtime',
        )).toThrow(/video runtime requires macOS 14\.0.*declares 13\.6\.9/i);
        expect(() => assertMacMinimumSystemVersionCompatible(
            '14.0.0',
            '14.0',
            'video runtime',
        )).not.toThrow();
        expect(() => assertMacMinimumSystemVersionCompatible(
            '13.5',
            '14.0',
            'video runtime',
        )).not.toThrow();
    });

    it.each([
        ['/opt/homebrew/lib/libomp.dylib', 'dependency'],
        ['/Library/Frameworks/Python.framework/Versions/3.12/Python', 'dependency'],
        ['/usr/local/lib/libavcodec.dylib', 'dependency'],
    ])('rejects external Mach-O %s %s', (externalPath) => {
        const context = macDependencyFixture();
        expect(() => assertRelocatableMacDependencyMetadata(
            'worker',
            `/tmp/worker:\n\t${externalPath} (compatibility version 1.0.0, current version 1.0.0)\n`,
            '',
            context,
        )).toThrow(/external Mach-O dependency/i);
    });

    it('rejects an absolute LC_RPATH into the build machine', () => {
        const context = macDependencyFixture();
        expect(() => assertRelocatableMacDependencyMetadata(
            'worker',
            '/tmp/worker:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)\n',
            'cmd LC_RPATH\ncmdsize 48\npath /opt/homebrew/lib (offset 12)\n',
            context,
        )).toThrow(/external Mach-O LC_RPATH/i);
    });

    it('rejects a loader-relative dependency that escapes the runtime root', () => {
        const context = macDependencyFixture();
        expect(() => assertRelocatableMacDependencyMetadata(
            'worker',
            '/tmp/worker:\n\t@loader_path/../../../../opt/homebrew/lib/libomp.dylib (compatibility version 1.0.0, current version 1.0.0)\n',
            '',
            context,
        )).toThrow(/escapes the runtime payload/i);
    });

    it('rejects a relocatable dependency reference when its file is absent', () => {
        const context = macDependencyFixture();
        expect(() => assertRelocatableMacDependencyMetadata(
            'worker',
            '/tmp/worker:\n\t@rpath/definitely-missing.dylib (compatibility version 1.0.0, current version 1.0.0)\n',
            'cmd LC_RPATH\ncmdsize 48\npath @loader_path/_internal (offset 12)\n',
            context,
        )).toThrow(/missing Mach-O dependency/i);
    });

    it('does not treat a system RPATH as proof that an arbitrary dependency exists', () => {
        const context = macDependencyFixture();
        expect(() => assertRelocatableMacDependencyMetadata(
            'worker',
            '/tmp/worker:\n\t@rpath/definitely-missing.dylib (compatibility version 1.0.0, current version 1.0.0)\n',
            'cmd LC_RPATH\ncmdsize 48\npath /usr/lib/swift (offset 12)\n',
            context,
        )).toThrow(/missing Mach-O dependency/i);
    });
});
