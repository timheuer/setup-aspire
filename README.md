# setup-aspire

Install the Aspire CLI on GitHub runners, add it to `PATH`, and cache it for faster pipelines.

## Inputs

- `version` (optional): Specific Aspire CLI version to install. Mutually exclusive with `quality`.
- `quality` (optional): Channel to install (`release`, `staging`, `dev`). Default resolved to `release` when `version` is not provided.
- `install-path` (optional): Directory for the Aspire CLI binaries. Defaults to the installer’s standard path (`~/.aspire/bin` or `%USERPROFILE%\.aspire\bin`).
- `os` / `arch` (optional): Override OS/arch detection (`win|linux|linux-musl|osx` / `x64|x86|arm64`).
- `dotnet-prereq-check` (optional, default `true`): Ensure .NET SDK 10.0+ is present before installing.
- `cache` (optional, default `true`): Cache the installed CLI using GitHub tool-cache.

## Outputs

- `cli-version`: Detected Aspire CLI version after installation.
- `bin-path`: Path added to `PATH` that contains the `aspire` executable.

## Usage

### Install latest release

```yaml
- name: Install Aspire CLI
  uses: ./
```

### Pin a version

```yaml
- name: Install Aspire CLI 13.0.0
  uses: ./
  with:
    version: 13.0.0
```

### Use staging channel and custom path

```yaml
- name: Install staging Aspire CLI
  uses: ./
  with:
    quality: staging
    install-path: ${{ runner.temp }}/aspire/bin
```

### Matrix across OSes

```yaml
jobs:
  test-aspire:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: ./
      - run: aspire --version
```

## Notes

- The action enforces mutual exclusivity: provide either `version` **or** `quality` (not both).
- It validates `.NET SDK >= 10.0.0` by default; set `dotnet-prereq-check: false` to skip (not recommended).
- Caching uses the GitHub tool-cache keyed by `version` or `quality-*`; on cache hit the installer is skipped.
