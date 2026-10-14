/**
 * Lockfile surgery for one package, shared by install and uninstall.
 *
 * pnpm 11 records a package installed from a tarball in THREE places:
 *
 *   importers.<project>.dependencies   `'<name>':` + specifier/version
 *   packages                           `'<name>@<specifier>':` + resolution/integrity
 *   snapshots                          `'<name>@<specifier>':`
 *
 * The last two embed the specifier in the KEY, so a package that moves from one
 * tarball path to another (or from a tarball to a linked directory) leaves
 * orphans behind unless every shape is matched. Dropping only the bare key is
 * the mistake this module exists to prevent.
 *
 * @module tools/lockfile
 */

/**
 * Normalize one lockfile key line to the bare key it names.
 *
 * pnpm quotes keys that need it (`'@scope/name':`, `'name@spec':`) and leaves
 * others bare (`dsh-imagegen:`). Stripping only a LEADING quote is the trap
 * here: `'@scope/name':` keeps its trailing quote and colon, never equals the
 * package name, and the entry then survives every cleanup — which is how a
 * lockfile ends up with the same package listed twice.
 * @param line - one raw line of `pnpm-lock.yaml`.
 * @returns the key without its quotes and trailing colon.
 */
function lockKey(line) {
  return line.trim().replace(/:$/u, '').replace(/^'+|'+$/gu, '')
}

/**
 * Read the `specifier:` value of a package's importer entry.
 * @param lockText - the whole `pnpm-lock.yaml`.
 * @param name - package name.
 * @returns the specifier string, or undefined when the package has no entry.
 */
export function importerSpecifier(lockText, name) {
  const lines = lockText.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (lockKey(lines[index]) !== name) continue
    const match = /^specifier:\s*(.+)$/u.exec((lines[index + 1] ?? '').trim())
    return match?.[1]
  }
  return undefined
}

/**
 * Drop every lockfile entry that belongs to one of `names`.
 *
 * A key's value may span several indented lines, so removal consumes the whole
 * block: stopping at the key would leave a dangling `resolution:`/`integrity:`
 * fragment that corrupts the next parse.
 *
 * @param lockText - the whole `pnpm-lock.yaml`.
 * @param names - package names to remove (including names from a previous rename).
 * @returns the rewritten text and whether anything matched.
 */
export function stripLockfileEntries(lockText, names) {
  const lines = lockText.split('\n')
  const kept = []
  let removed = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const key = lockKey(line)
    const owns = names.some((name) => key === name || key.startsWith(`${name}@`))
    if (!owns) {
      kept.push(line)
      continue
    }
    removed = true
    const keyIndent = line.length - line.trimStart().length
    while (index + 1 < lines.length) {
      const next = lines[index + 1]
      if (next.trim() === '') break
      const nextIndent = next.length - next.trimStart().length
      if (nextIndent <= keyIndent) break
      index += 1
    }
  }

  return { text: kept.join('\n'), removed }
}

/**
 * Insert one importer entry into a lockfile that already has its anchor.
 * @param lockText - the whole `pnpm-lock.yaml`.
 * @param block - the pre-indented entry text (key line plus its indented fields).
 * @returns the rewritten text, or undefined when the anchor is missing.
 */
export function insertImporterEntry(lockText, block) {
  const anchor = '  .:\n    dependencies:\n'
  const at = lockText.indexOf(anchor)
  if (at === -1) return undefined
  const insertAt = at + anchor.length
  return `${lockText.slice(0, insertAt)}${block}${lockText.slice(insertAt)}`
}
