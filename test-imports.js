import fs from "fs";
import path from "path";
import crypto from "crypto";
console.log(typeof fs.promises.readFile, typeof path.dirname, typeof crypto.createHash);
