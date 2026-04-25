import fs from "bare-fs";
import fsp from "bare-fs/promises";
import path from "bare-path";
import crypto from "bare-crypto";
console.log(typeof fsp.readFile, typeof fs.promises.readFile);
console.log(typeof path.dirname);
console.log(typeof crypto.createHash);
