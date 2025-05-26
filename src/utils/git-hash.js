// Ref: https://github.com/creationix/js-git/blob/master/lib/object-codec.js
// Ref: https://github.com/creationix/js-git/blob/master/lib/modes.js
// Ref: https://github.com/creationix/bodec/blob/master/bodec-browser.js

import { textToBytes, hexToBytes, bytesToHex, concatBytes } from './conversions.js';
import { hash } from './crypto.js';
import { getType } from '../types.js';

async function gitHash (bytes, type = 'blob', algo = 'SHA-1') {
  const mergedBytes = await concatBytes([
    textToBytes(`${type} ${bytes.length}\0`),
    bytes
  ]);
  return bytesToHex(await hash(mergedBytes, algo));
}

// Params: input <boolean | string | number | array | object | ArrayBuffer | Uint8Array>
export async function blobHash (input) {
  let bytes;
  switch (getType(input)) {
    case 'Number':
    case 'Boolean':
    case 'String':
      bytes = textToBytes(input.toString());
      break;
    case 'Array':
    case 'Object':
      bytes = textToBytes(JSON.stringify(input));
      break;
    case 'Uint8Array':
      bytes = input;
      break;
    case 'ArrayBuffer':
      bytes = new Uint8Array(input);
      break;
    default:
      throw new Error('Unsupported parameter type');
  }
  return gitHash(bytes);
}

// Ref: https://github.com/creationix/js-git/blob/master/lib/modes.js
const modes = {
  tree: '40000',
  blob: '100644',
  file: '100644',
  exec: '100755',
  sym: '120000',
  commit: '160000'
};

// Brief: Called by encodeTree() below
// Ref: https://github.com/creationix/js-git/blob/master/lib/object-codec.js
function treeMap (key) {
  const entry = this[key]; // this refers to the second argument of map() in the caller
  return {
    name: key,
    mode: modes[entry.type],
    hash: entry.hash
  };
}

// Brief: Sort files (blobs) or directories (sub-trees) in a tree by their names
// Ref: https://github.com/creationix/js-git/blob/master/lib/object-codec.js
function treeSort (a, b) {
  const aa = (a.mode === modes.tree) ? a.name + '/' : a.name;
  const bb = (b.mode === modes.tree) ? b.name + '/' : b.name;
  return aa > bb ? 1 : aa < bb ? -1 : 0;
}

// Params: entries <object> Schema: { name as <string>: { type: <string>, hash: hex<string> }, ... }
// For allowed types, see keys in modes object above. Directory names don't have trailing slash.
// Example params:
// {
//   "file.txt": {
//     type: "blob", hash: "416804e55ec25359360c5cd0088424da5ac522b9"
//   },
//   "sub-dir": {
//     type: "tree", hash: "6b455df2c7121a4f23578ca35cdbdf5089e35b8f"
//   }
// }
// Returns: hex <string>
// Ref: https://github.com/creationix/js-git/blob/master/lib/object-codec.js
export async function treeHash (entries) {
  // Turn entries object to a sorted array, with types replaced by modes
  const entriesArray = Object.keys(entries).map(treeMap, entries).sort(treeSort);
  const accumulator = [];
  for (const entry of entriesArray) {
    accumulator.push(
      textToBytes(`${entry.mode} ${entry.name}\0`),
      hexToBytes(entry.hash)
    );
  }
  const tree = await concatBytes(accumulator);
  return gitHash(tree, 'tree');
}

// Params: date <Date>
// Returns: <string>
// Ref: https://github.com/creationix/js-git/blob/master/lib/object-codec.js
function formatDate (date) {
  const seconds = Math.floor(date.getTime() / 1000);
  const offset = '+0000';
  return `${seconds} ${offset}`;
}

// Params: date <string>
function formatPerson ({ name, email, date }) {
  // Check if date string can be parsed as Date. Otherwise, use as is.
  const gitDate = isNaN(Date.parse(date)) ? date : formatDate(new Date(date));
  return `${name} <${email}> ${gitDate}`;
}

// author | committer schema: { name, email, date }
export async function commitHash ({ treeHash, parentCommitHashes = [], message, author, committer }) {
  let commitContent;
  commitContent = parentCommitHashes.reduce((accumulator, parentCommitHash) => {
    return `${accumulator}\nparent ${parentCommitHash}`;
  }, `tree ${treeHash}`);
  commitContent += `\nauthor ${formatPerson(author)}`;
  commitContent += `\ncommitter ${formatPerson(committer)}`;
  commitContent += `\n\n${message ? message + '\n' : ''}`; // Add linefeed to message, if non-empty
  return gitHash(textToBytes(commitContent), 'commit');
}

// object schema: { hash, type }
// tagger schema: { name, email, date }
export async function annotatedTagHash ({ object, tag, tagger, message }) {
  let annotatedTagContent = `object ${object.hash}`;
  annotatedTagContent += `\ntype ${object.type}`;
  annotatedTagContent += `\ntag ${tag}`;
  annotatedTagContent += `\ntagger ${formatPerson(tagger)}`;
  annotatedTagContent += `\n\n${message}\n`; // Add linefeed to message
  return gitHash(textToBytes(annotatedTagContent), 'tag');
}
