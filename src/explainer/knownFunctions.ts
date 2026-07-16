/**
 * Dictionary of well-known C standard library functions.
 * Pure data + string assembly — no parsing logic, no HTML. The `function_call`
 * case in explainer.ts checks this map first; unmapped functions keep the
 * generic "Calls the function ..." sentence.
 */

export interface KnownFunction {
  summary: string;
  /** Meaning of each argument by position, used as Syntax Breakdown row labels. */
  params: string[];
  build(args: string[]): string;
  /** Optional per-argument Syntax Breakdown value override, e.g. "1 (the terminal)" for a fd. Defaults to the raw argument text. */
  argValue?(arg: string, index: number): string;
}

/** String literals read as the text itself, numbers as their value, variables as "whatever X holds". */
function describeArg(arg: string): string {
  const trimmed = arg.trim();
  if (/^"([^"\\]|\\.)*"$/.test(trimmed)) return trimmed;
  if (/^0[xX][0-9a-fA-F]+$|^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (/^[A-Za-z_]\w*$/.test(trimmed)) return `whatever ${trimmed} holds`;
  return trimmed;
}

const STD_FDS: Record<string, { name: string; place: string }> = {
  '0': { name: 'standard input', place: 'the keyboard' },
  '1': { name: 'standard output', place: 'the terminal' },
  '2': { name: 'standard error', place: 'the terminal, as an error' },
};

function fdPlace(fd: string): string {
  return STD_FDS[fd.trim()]?.place ?? `file descriptor ${fd.trim()}`;
}

/** e.g. "1 (the terminal)" — used to annotate the fd argument's Syntax Breakdown row. */
function fdArgValue(fd: string): string {
  const known = STD_FDS[fd.trim()];
  return known ? `${fd.trim()} (${known.place})` : fd.trim();
}

function plural(count: string, word: string): string {
  return `${count} ${word}${count.trim() === '1' ? '' : 's'}`;
}

export const KNOWN_FUNCTIONS: Record<string, KnownFunction> = {
  write: {
    summary: 'sends bytes to a file descriptor',
    params: ['where to send it', 'what to send', 'how many bytes'],
    argValue: (arg, index) => (index === 0 ? fdArgValue(arg) : arg),
    build([fd, buf, count]) {
      const place = fdPlace(fd);
      const known = STD_FDS[fd.trim()];
      const base = `Writes ${describeArg(buf)} to ${place} — ${plural(count, 'byte')} of it.`;
      return known ? `${base} (The first ${fd.trim()} means "${known.name}", which is ${place}.)` : base;
    },
  },
  read: {
    summary: 'reads bytes from a file descriptor',
    params: ['where to read from', 'where to store it', 'how many bytes (max)'],
    argValue: (arg, index) => (index === 0 ? fdArgValue(arg) : arg),
    build([fd, buf, count]) {
      const place = fdPlace(fd);
      const known = STD_FDS[fd.trim()];
      const base = `Reads up to ${plural(count, 'byte')} from ${place} into ${buf.trim()}.`;
      return known ? `${base} (The first ${fd.trim()} means "${known.name}", which is ${place}.)` : base;
    },
  },
  printf: {
    summary: 'prints formatted text to the terminal',
    params: ['format string'],
    build([format, ...rest]) {
      const base = `Prints ${describeArg(format)} to the terminal`;
      return rest.length ? `${base}, filling in ${rest.map(describeArg).join(', ')}.` : `${base}.`;
    },
  },
  putchar: {
    summary: 'prints a single character',
    params: ['the character to print'],
    build([c]) {
      return `Prints the character ${describeArg(c)} to the terminal.`;
    },
  },
  malloc: {
    summary: 'allocates memory on the heap',
    params: ['how many bytes to allocate'],
    build([size]) {
      return `Allocates ${describeArg(size)} bytes of memory on the heap and gives back a pointer to it.`;
    },
  },
  free: {
    summary: 'frees previously allocated memory',
    params: ['the pointer to free'],
    build([ptr]) {
      return `Frees the memory that ${ptr.trim()} points to.`;
    },
  },
  strlen: {
    summary: 'counts the characters in a string',
    params: ['the string to measure'],
    build([str]) {
      return `Counts the number of characters in ${str.trim()}, not including the ending null byte.`;
    },
  },
  strcpy: {
    summary: 'copies a string',
    params: ['destination', 'source'],
    build([dest, src]) {
      return `Copies the text from ${src.trim()} into ${dest.trim()}.`;
    },
  },
  open: {
    summary: 'opens a file',
    params: ['file path', 'flags'],
    build([path]) {
      return `Opens the file ${describeArg(path)} and gives back a file descriptor to use with it.`;
    },
  },
  close: {
    summary: 'closes a file descriptor',
    params: ['the file descriptor to close'],
    build([fd]) {
      return `Closes file descriptor ${fd.trim()}, freeing it up.`;
    },
  },
  exit: {
    summary: 'ends the program immediately',
    params: ['exit status code'],
    build([code]) {
      return `Ends the program right here and reports the exit code ${describeArg(code)} to the operating system.`;
    },
  },
  scanf: {
    summary: 'reads formatted input from the keyboard',
    params: ['format string'],
    build([format, ...rest]) {
      const base = `Reads input from the keyboard, matching the format ${describeArg(format)}`;
      return rest.length ? `${base} and storing it into ${rest.map(a => a.trim()).join(', ')}.` : `${base}.`;
    },
  },
};
