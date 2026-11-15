import { DatabaseSync } from "node:sqlite";
import * as vec from "sqlite-vec";
const p = vec.getLoadablePath ? vec.getLoadablePath() : vec.default.getLoadablePath();
const db = new DatabaseSync(":memory:");
db.loadExtension(p);
db.exec("CREATE VIRTUAL TABLE v USING vec0(embedding float[4])");
const ins = db.prepare("INSERT INTO v(rowid, embedding) VALUES (?, ?)");
ins.run(1n, new Uint8Array(new Float32Array([1,0,0,0]).buffer));
ins.run(2n, new Uint8Array(new Float32Array([0,1,0,0]).buffer));
const r = db.prepare("SELECT rowid, distance FROM v WHERE embedding MATCH ? ORDER BY distance LIMIT 2")
  .all(new Uint8Array(new Float32Array([0.9,0.1,0,0]).buffer));
console.log("sqlite-vec OK, vec_version =", db.prepare("select vec_version() v").get().v);
console.log("search:", JSON.stringify(r));
