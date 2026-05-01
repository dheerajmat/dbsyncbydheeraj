export const generateSQL = (diff, schemaA) => {
  const queries = [];

  // 1. Missing Tables in B
  diff.missingTablesInB.forEach(tableName => {
    const cols = schemaA.columns.filter(c => c.table_name === tableName);
    const colDefs = cols.map(col => {
      let def = `  ${col.column_name} ${pgType(col)}`;
      if (col.is_nullable === 'NO') def += ' NOT NULL';
      if (col.column_default) def += ` DEFAULT ${col.column_default}`;
      return def;
    });
    queries.push({
      type: 'CREATE_TABLE',
      table: tableName,
      sql: `CREATE TABLE ${tableName} (\n${colDefs.join(',\n')}\n);`
    });
  });

  // 2. Column differences
  diff.columnDifferences.forEach(d => {
    if (d.type === 'missing_column_in_B') {
      const col = d.details;
      let sql = `ALTER TABLE ${d.table} ADD COLUMN ${d.column} ${pgType(col)}`;
      if (col.is_nullable === 'NO') sql += ' NOT NULL';
      if (col.column_default) sql += ` DEFAULT ${col.column_default}`;
      sql += ';';
      queries.push({ type: 'ADD_COLUMN', table: d.table, column: d.column, sql });
    }

    if (d.type === 'missing_column_in_A') {
      queries.push({
        type: 'INFO_EXTRA_COLUMN_IN_B',
        table: d.table,
        column: d.column,
        sql: `-- Column "${d.column}" exists in B but NOT in A (table: ${d.table}). Drop manually if needed:\n-- ALTER TABLE ${d.table} DROP COLUMN ${d.column};`
      });
    }

    if (d.type === 'column_mismatch') {
      d.issues.forEach(issue => {
        if (issue.field === 'data_type') {
          queries.push({
            type: 'MODIFY_COLUMN_TYPE',
            table: d.table,
            column: d.column,
            sql: `ALTER TABLE ${d.table} ALTER COLUMN ${d.column} TYPE ${pgType(d.detailsA)} USING ${d.column}::${pgType(d.detailsA)};`,
            comment: `Type: B has "${issue.B}", A has "${issue.A}"`
          });
        }
        if (issue.field === 'is_nullable') {
          const sql = issue.A === 'NO'
            ? `ALTER TABLE ${d.table} ALTER COLUMN ${d.column} SET NOT NULL;`
            : `ALTER TABLE ${d.table} ALTER COLUMN ${d.column} DROP NOT NULL;`;
          queries.push({ type: 'MODIFY_NULLABLE', table: d.table, column: d.column, sql, comment: `Nullable: B="${issue.B}", A="${issue.A}"` });
        }
        if (issue.field === 'column_default') {
          const sql = issue.A != null
            ? `ALTER TABLE ${d.table} ALTER COLUMN ${d.column} SET DEFAULT ${issue.A};`
            : `ALTER TABLE ${d.table} ALTER COLUMN ${d.column} DROP DEFAULT;`;
          queries.push({ type: 'MODIFY_DEFAULT', table: d.table, column: d.column, sql, comment: `Default: B="${issue.B}", A="${issue.A}"` });
        }
        if (issue.field === 'character_maximum_length' || issue.field === 'numeric_precision' || issue.field === 'numeric_scale') {
          queries.push({
            type: 'INFO_LENGTH_MISMATCH',
            table: d.table,
            column: d.column,
            sql: `-- ${issue.field} mismatch on ${d.table}.${d.column}: A=${issue.A}, B=${issue.B}\n-- ALTER TABLE ${d.table} ALTER COLUMN ${d.column} TYPE ${pgType(d.detailsA)} USING ${d.column}::${pgType(d.detailsA)};`,
            comment: `${issue.field}: B="${issue.B}", A="${issue.A}"`
          });
        }
      });
    }
  });

  // 3. Functions
  (diff.functionDifferences || []).forEach(f => {
    if (f.type === 'missing_in_B' || f.type === 'body_mismatch') {
      queries.push({
        type: f.type === 'missing_in_B' ? 'CREATE_FUNCTION' : 'REPLACE_FUNCTION',
        name: f.name,
        sql: f.definitionA.replace(/^CREATE FUNCTION/i, 'CREATE OR REPLACE FUNCTION') + ';'
      });
    }
    if (f.type === 'missing_in_A') {
      queries.push({
        type: 'INFO_EXTRA_FUNCTION_IN_B',
        name: f.name,
        sql: `-- Function "${f.name}" exists in B but NOT in A. Drop manually if needed:\n-- DROP FUNCTION IF EXISTS ${f.name};`
      });
    }
  });

  // 4. Triggers
  (diff.triggerDifferences || []).forEach(t => {
    if (t.type === 'missing_in_B' || t.type === 'trigger_mismatch') {
      const d = t.detailsA;
      const whenClause = d.action_condition ? `\n  WHEN (${d.action_condition})` : '';
      const forEach = d.action_orientation === 'ROW' ? ' FOR EACH ROW' : (d.action_orientation === 'STATEMENT' ? ' FOR EACH STATEMENT' : '');
      
      queries.push({
        type: t.type === 'missing_in_B' ? 'CREATE_TRIGGER' : 'REPLACE_TRIGGER',
        name: t.name,
        sql: [
          `DROP TRIGGER IF EXISTS ${d.trigger_name} ON ${d.table_name};`,
          `CREATE TRIGGER ${d.trigger_name}\n  ${d.action_timing} ${d.event_manipulation} ON ${d.table_name}${forEach}${whenClause}\n  ${d.action_statement};`
        ].join('\n')
      });
    }
    if (t.type === 'missing_in_A') {
      const d = t.detailsB;
      queries.push({
        type: 'INFO_EXTRA_TRIGGER_IN_B',
        name: t.name,
        sql: `-- Trigger "${d.trigger_name}" on "${d.table_name}" exists in B but NOT in A.\n-- DROP TRIGGER IF EXISTS ${d.trigger_name} ON ${d.table_name};`
      });
    }
  });

  // 5. Sequences
  (diff.sequenceDifferences || []).forEach(s => {
    if (s.type === 'missing_in_B') {
      const d = s.detailsA;
      const owned = d.owned_by_table && d.owned_by_column
        ? `\nOWNED BY ${d.owned_by_table}.${d.owned_by_column}` : '';
      queries.push({
        type: 'CREATE_SEQUENCE',
        name: s.name,
        sql: `CREATE SEQUENCE IF NOT EXISTS ${s.name}\n  AS ${d.data_type}\n  START WITH ${d.start_value}\n  INCREMENT BY ${d.increment}\n  MINVALUE ${d.minimum_value}\n  MAXVALUE ${d.maximum_value}\n  CACHE ${d.cache_size}${d.cycle_option === 'YES' ? '\n  CYCLE' : '\n  NO CYCLE'}${owned};`
      });
    }
    if (s.type === 'sequence_mismatch') {
      const d = s.detailsA;
      const alterParts = s.issues.map(iss => {
        if (iss.field === 'start_value') return `  START WITH ${iss.A}`;
        if (iss.field === 'increment') return `  INCREMENT BY ${iss.A}`;
        if (iss.field === 'minimum_value') return `  MINVALUE ${iss.A}`;
        if (iss.field === 'maximum_value') return `  MAXVALUE ${iss.A}`;
        if (iss.field === 'cache_size') return `  CACHE ${iss.A}`;
        if (iss.field === 'cycle_option') return iss.A === 'YES' ? '  CYCLE' : '  NO CYCLE';
        return null;
      }).filter(Boolean);
      if (alterParts.length)
        queries.push({
          type: 'ALTER_SEQUENCE',
          name: s.name,
          sql: `ALTER SEQUENCE ${s.name}\n${alterParts.join('\n')};`
        });
    }
    if (s.type === 'missing_in_A') {
      queries.push({
        type: 'INFO_EXTRA_SEQUENCE_IN_B',
        name: s.name,
        sql: `-- Sequence "${s.name}" exists in B but NOT in A.\n-- DROP SEQUENCE IF EXISTS ${s.name};`
      });
    }
  });

  return queries;
};

// Build the correct Postgres type string including length/precision
const pgType = (col) => {
  const t = col.data_type.toUpperCase();
  if (col.character_maximum_length) return `${t}(${col.character_maximum_length})`;
  if (col.numeric_precision != null && col.numeric_scale != null) return `${t}(${col.numeric_precision},${col.numeric_scale})`;
  return t;
};
