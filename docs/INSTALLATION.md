# Verified local CLI installation

The CLI is installed from a reviewed local `.tgz` archive. It is not an npm
registry package. Do not replace the archive path with a registry package name.

Use a `SHA256SUMS` file obtained with the exact archive from the same reviewed
release or release-candidate artifact set. The trusted checksum authority is the
reviewed project release record that names that asset; a checksum copied from an
unrelated issue, message, or mirror is not sufficient.

## One local installation command

Using the installer supplied with the reviewed v0.9.0 release archive (or `scripts/install-cli.mjs` from the same trusted source checkout), run:

```sh
node /absolute/path/to/install-cli.mjs \
  /absolute/path/to/styleconstitution-cli-<version>.tgz \
  /absolute/path/to/SHA256SUMS \
  /absolute/path/to/new-stylecon-consumer
```

The third path must be new. The command verifies the archive SHA-256 before it
creates that directory or invokes npm. It installs only the supplied local
archive with `--ignore-scripts --save-exact --no-audit --no-fund`, then verifies
the installed package name, version, `stylecon` bin path, and bin entry file
against the manifest inside the verified archive.

On success, `new-stylecon-consumer/installation-evidence.json` records the
archive filename, SHA-256, verified package identity, and the fact that browser
installation has not yet occurred. A failed install leaves the verified archive
copy and npm output in the new directory for inspection; it creates no success
receipt.

## Obtain the inputs

For a released version, download the CLI `.tgz` and its accompanying
`SHA256SUMS` from the same official project release and compare the asset names
with the reviewed release record. For the next release candidate, use artifacts
made by the reviewed local packaging workflow together with its emitted
`SHA256SUMS`. The development packaging command includes `install-cli.mjs` and
its checksum. Verify the installer checksum before running it. The v0.9.0 release includes this installer and Studio; v0.6.0 assets do not.

After installation, run the installed command without downloading a package:

```sh
cd /absolute/path/to/new-stylecon-consumer
npx --no-install stylecon browser-install
npx --no-install stylecon doctor
```

Browser installation is an explicit separate step. npm may fetch the archive's
locked runtime dependencies; their install hooks are disabled. The installer does not
publish packages, contact a package registry for the CLI, or treat a successful
file copy as browser verification.
