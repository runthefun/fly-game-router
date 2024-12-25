/*
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import { Logger } from "./types";

interface Log {
  id: number;
  date: string;
  tag: string;
  log: string;
}

const DB_FILE = process.env.NODE_ENV === "production" ? "logs.db" : ":memory:";

class DbManager {
  //
  _db = new DatabaseSync(DB_FILE);

  _logger = new DbLogger(this._db);

  get logger() {
    return this._logger;
  }
}

class DbLogger implements Logger {
  //
  constructor(private _db: DatabaseSync) {
    //
    this.init();
  }

  init() {
    this._db.exec(`
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            tag TEXT,
            log TEXT
        );
      `);
  }

  _addLog(tag: string, ...args: string[]) {
    const log = args.join(" ");
    this._db
      .prepare("INSERT INTO logs (date, tag, log) VALUES (?, ?, ?)")
      .run(new Date().toISOString(), tag, log);
  }

  dumpLogs(file?: string) {
    const logs = this._db.prepare("SELECT * FROM logs").all() as Log[];

    let lines = logs.map(
      (l) => `${l.date.padEnd(15)} ${l.tag.padEnd(15)} ${l.log}`
    );

    if (file) {
      fs.writeFileSync(file, lines.join("\n"));
    } else {
      console.log(lines.join("\n"));
    }
  }

  log(...args: any[]) {
    this._addLog("LOG", ...args);
  }

  warn(...args: any[]) {
    this._addLog("WARN", ...args);
  }

  error(...args: any[]) {
    this._addLog("ERROR", ...args);
  }
}

export const Db = new DbManager();
*/
