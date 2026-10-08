// Roll names and capture file names: <roll>/<roll>_<4-digit index>.{jpg,dng}

// Letters, digits, space, hyphen and underscore; 1 to 40 characters; no space at either end.
const ROLL = /^[\p{L}\p{N}_-](?:[\p{L}\p{N} _-]{0,38}[\p{L}\p{N}_-])?$/u;

export function isValidRoll(name: string): boolean {
  return ROLL.test(name);
}

export function fileBase(roll: string, index: number): string {
  return `${roll}_${String(index).padStart(4, '0')}`;
}

/** One more than the highest index already used by this roll's files; 1 when there are none. */
export function nextIndex(roll: string, fileNames: Iterable<string>): number {
  const prefix = `${roll}_`;
  let max = 0;
  for (const name of fileNames) {
    if (!name.startsWith(prefix)) continue;
    const match = /^(\d{4,})\.(?:jpg|dng)$/.exec(name.slice(prefix.length));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}
