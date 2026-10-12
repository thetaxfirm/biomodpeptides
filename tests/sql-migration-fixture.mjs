// Drizzle delimits complete statements, including trigger bodies. Keep their internal
// semicolons intact; ordinary SQL may also contain a semicolon inside a quoted value.
export function migrationStatements(source) {
  return source.split(/^--> statement-breakpoint\s*$/m).flatMap(part => {
    const sql = part.replace(/^--.*$/gm, '').trim();
    if (!sql) return [];
    if (/^CREATE\s+TRIGGER\b/i.test(sql)) return [sql];
    if (/\bCREATE\s+TRIGGER\b/i.test(sql)) throw Error('Trigger migration requires a statement-breakpoint before the complete trigger.');
    const statements = []; let start = 0, quote = '';
    for (let index = 0; index < sql.length; index++) {
      const character = sql[index];
      if (quote) {
        if (character === quote) {
          if (sql[index + 1] === quote) index++;
          else quote = '';
        }
      } else if (character === "'" || character === '"' || character === '`') quote = character;
      else if (character === '[') quote = ']';
      else if (character === ';') { const statement = sql.slice(start, index).trim(); if (statement) statements.push(statement); start = index + 1; }
    }
    if (quote) throw Error('Unterminated quoted value in migration fixture.');
    const last = sql.slice(start).trim(); if (last) statements.push(last);
    return statements;
  });
}
