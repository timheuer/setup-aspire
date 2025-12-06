import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as tc from '@actions/tool-cache';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TOOL_NAME = 'aspire';
const MIN_DOTNET_VERSION = '10.0.0';

type Platform = 'windows' | 'linux' | 'darwin';

function parseBool(input: string | undefined, defaultValue: boolean): boolean {
  if (input === undefined || input === '') return defaultValue;
  return ['true', '1', 'yes', 'on'].includes(input.toLowerCase());
}

function compareVersions(candidate: string, minimum: string): boolean {
  const toNums = (v: string) => v.split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const a = toNums(candidate);
  const b = toNums(minimum);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return true;
}

async function ensureDotnet(minVersion: string): Promise<void> {
  try {
    const output = await exec.getExecOutput('dotnet', ['--version'], { silent: true });
    if (output.exitCode !== 0) {
      throw new Error('dotnet --version exited with non-zero code');
    }
    const version = output.stdout.trim().split(/\s+/)[0];
    if (!compareVersions(version, minVersion)) {
      throw new Error(`.NET SDK ${minVersion}+ is required; detected ${version}`);
    }
    core.info(`Detected .NET SDK ${version}`);
  } catch (err) {
    throw new Error(`.NET SDK check failed. Ensure .NET SDK ${minVersion}+ is installed on the runner. Inner error: ${String(err)}`);
  }
}

function detectPlatform(): Platform {
  const plat = process.platform;
  if (plat === 'win32') return 'windows';
  if (plat === 'darwin') return 'darwin';
  return 'linux';
}

async function downloadInstaller(isWindows: boolean): Promise<string> {
  const url = isWindows ? 'https://aspire.dev/install.ps1' : 'https://aspire.dev/install.sh';
  core.info(`Downloading Aspire installer from ${url}`);
  const downloadPath = await tc.downloadTool(url);
  if (isWindows) {
    const renamed = `${downloadPath}.ps1`;
    await io.mv(downloadPath, renamed);
    return renamed;
  }
  fs.chmodSync(downloadPath, 0o755);
  return downloadPath;
}

async function runInstaller(
  scriptPath: string,
  isWindows: boolean,
  args: string[],
): Promise<void> {
  const command = isWindows ? 'pwsh' : 'bash';
  const fullArgs = isWindows
    ? ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]
    : [scriptPath, ...args];
  await exec.exec(command, fullArgs, { ignoreReturnCode: false });
}

function versionLabel(version: string | undefined, quality: string | undefined): string {
  if (version) return version;
  return `quality-${quality ?? 'release'}`;
}

function extractSemver(line: string): string {
  const match = line.match(/\d+\.\d+\.\d+(?:[+-][\w\.]+)?/);
  return match?.[0] ?? line.trim();
}

async function validateAspire(binPath: string): Promise<string> {
  const envPath = `${binPath}${path.delimiter}${process.env.PATH ?? ''}`;
  const res = await exec.getExecOutput('aspire', ['--version'], {
    env: { ...process.env, PATH: envPath },
    silent: true,
  });
  if (res.exitCode !== 0) {
    throw new Error(`aspire --version failed with exit code ${res.exitCode}: ${res.stderr || res.stdout}`);
  }
  const firstLine = (res.stdout || '').split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const parsed = extractSemver(firstLine);
  core.info(`Aspire CLI version: ${parsed}`);
  return parsed;
}

async function installAspire(options: {
  version?: string;
  quality?: string;
  installPath: string;
  osOverride?: string;
  archOverride?: string;
  isWindows: boolean;
}): Promise<void> {
  await io.mkdirP(options.installPath);
  const args: string[] = ['--install-path', options.installPath];
  if (options.version) {
    args.push('--version', options.version);
  } else if (options.quality) {
    args.push('--quality', options.quality);
  }
  if (options.osOverride) {
    args.push('--os', options.osOverride);
  }
  if (options.archOverride) {
    args.push('--arch', options.archOverride);
  }

  const scriptPath = await downloadInstaller(options.isWindows);
  core.info(`Running Aspire installer to ${options.installPath}`);
  await runInstaller(scriptPath, options.isWindows, args);
}

async function run(): Promise<void> {
  try {
    const rawVersion = core.getInput('version', { trimWhitespace: true }) || undefined;
    const rawQualityInput = core.getInput('quality', { trimWhitespace: true });
    const quality = rawQualityInput || undefined;
    const installPathInput = core.getInput('install-path', { trimWhitespace: true });
    const osOverride = core.getInput('os', { trimWhitespace: true }) || undefined;
    const archOverride = core.getInput('arch', { trimWhitespace: true }) || undefined;
    const dotnetPrereqCheck = parseBool(core.getInput('dotnet-prereq-check'), true);
    const cacheEnabled = parseBool(core.getInput('cache'), true);

    if (rawVersion && quality) {
      throw new Error('Inputs "version" and "quality" are mutually exclusive. Provide only one.');
    }

    const platform = detectPlatform();
    const isWindows = platform === 'windows';
    const homeDir = os.homedir();
    const defaultInstallPath = isWindows
      ? path.join(homeDir, '.aspire', 'bin')
      : path.join(homeDir, '.aspire', 'bin');
    const installPath = installPathInput || defaultInstallPath;

    if (dotnetPrereqCheck) {
      await ensureDotnet(MIN_DOTNET_VERSION);
    } else {
      core.info('Skipping .NET SDK prerequisite check as requested.');
    }

    const label = versionLabel(rawVersion, quality);
    let binPath: string | undefined;

    if (cacheEnabled) {
      const found = tc.find(TOOL_NAME, label);
      if (found) {
        binPath = found;
        core.info(`Using cached Aspire CLI at ${binPath}`);
      }
    }

    if (!binPath) {
      await installAspire({
        version: rawVersion,
        quality: rawVersion ? undefined : quality ?? 'release',
        installPath,
        osOverride,
        archOverride,
        isWindows,
      });

      if (cacheEnabled) {
        binPath = await tc.cacheDir(installPath, TOOL_NAME, label);
        core.info(`Cached Aspire CLI to ${binPath}`);
      } else {
        binPath = installPath;
      }
    }

    core.addPath(binPath);
    const cliVersion = await validateAspire(binPath);

    core.setOutput('cli-version', cliVersion);
    core.setOutput('bin-path', binPath);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed(`Unknown error: ${String(error)}`);
    }
  }
}

run();
