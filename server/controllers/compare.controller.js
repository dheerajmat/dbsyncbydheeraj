import { getSchema } from '../services/pgCompare.service.js';
import { compareSchemas } from '../services/diffEngine.service.js';
import { generateSQL } from '../services/sqlGenerator.service.js';
import pg from 'pg';

export const handleDirectCompare = async (req, res) => {
  const { dbA, dbB } = req.body;

  try {
    const schemaA = await getSchema(dbA);
    const schemaB = await getSchema(dbB);

    const diff = compareSchemas(schemaA, schemaB);
    
    res.json({
      success: true,
      diff,
      schemaA, // Useful for the frontend to show details
      schemaB
    });
  } catch (error) {
    console.error('Comparison Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const handleGenerateSQL = (req, res) => {
  const { diff, schemaA } = req.body;
  try {
    // Ensure all arrays exist to prevent crashes on round-trip JSON
    diff.columnDifferences = diff.columnDifferences || [];
    diff.missingTablesInB = diff.missingTablesInB || [];
    diff.missingTablesInA = diff.missingTablesInA || [];
    diff.functionDifferences = diff.functionDifferences || [];
    diff.triggerDifferences = diff.triggerDifferences || [];
    diff.sequenceDifferences = diff.sequenceDifferences || [];
    const sqlCommands = generateSQL(diff, schemaA);
    res.json({ success: true, sqlCommands });
  } catch (error) {
    console.error('GenerateSQL Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const handleGeneratePrompt = (req, res) => {
  const { diff, schemaA, dbAName, dbBName } = req.body;
  try {
    const prompt = buildAIPrompt(diff, schemaA, dbAName || 'Database A', dbBName || 'Database B');
    res.json({ success: true, prompt });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const buildAIPrompt = (diff, schemaA, dbAName, dbBName) => {
  const lines = [];

  lines.push(`You are a PostgreSQL expert. I have two databases:`);
  lines.push(`- Source (A): "${dbAName}" — this is the REFERENCE (correct) schema`);
  lines.push(`- Target (B): "${dbBName}" — this needs to be updated to match A`);
  lines.push(``);
  lines.push(`Generate a complete, safe, production-ready PostgreSQL migration script to bring B in sync with A.`);
  lines.push(`Use IF NOT EXISTS / IF EXISTS guards wherever possible. Add comments for each section.`);
  lines.push(``);
  lines.push(`=== DIFFERENCES FOUND ===`);
  lines.push(``);

  // Missing tables
  if (diff.missingTablesInB?.length) {
    lines.push(`--- TABLES MISSING IN B (need CREATE TABLE) ---`);
    diff.missingTablesInB.forEach(tableName => {
      const cols = (schemaA.columns || []).filter(c => c.table_name === tableName);
      lines.push(``);
      lines.push(`Table: "${tableName}"`);
      lines.push(`Columns:`);
      cols.forEach(col => {
        let desc = `  - ${col.column_name}: ${col.data_type}`;
        if (col.character_maximum_length) desc += `(${col.character_maximum_length})`;
        else if (col.numeric_precision != null) desc += `(${col.numeric_precision},${col.numeric_scale ?? 0})`;
        if (col.is_nullable === 'NO') desc += ' NOT NULL';
        if (col.column_default) desc += ` DEFAULT ${col.column_default}`;
        lines.push(desc);
      });
      const constraints = (schemaA.constraints || []).filter(c => c.table_name === tableName);
      if (constraints.length) {
        lines.push(`Constraints:`);
        constraints.forEach(c => lines.push(`  - ${c.column_name}: ${c.constraint_type} (${c.constraint_name})`) );
      }
    });
    lines.push(``);
  }

  // Extra tables in B
  if (diff.missingTablesInA?.length) {
    lines.push(`--- TABLES ONLY IN B (exist in B but NOT in A — do NOT drop automatically, just note them) ---`);
    diff.missingTablesInA.forEach(t => lines.push(`  - "${t}"`) );
    lines.push(``);
  }

  // Column differences
  if (diff.columnDifferences?.length) {
    lines.push(`--- COLUMN DIFFERENCES ---`);
    diff.columnDifferences.forEach(d => {
      lines.push(``);
      if (d.type === 'missing_column_in_B') {
        const col = d.details;
        let colDesc = `${col.data_type}`;
        if (col.character_maximum_length) colDesc += `(${col.character_maximum_length})`;
        else if (col.numeric_precision != null) colDesc += `(${col.numeric_precision},${col.numeric_scale ?? 0})`;
        if (col.is_nullable === 'NO') colDesc += ' NOT NULL';
        if (col.column_default) colDesc += ` DEFAULT ${col.column_default}`;
        lines.push(`Table "${d.table}": ADD column "${d.column}" ${colDesc}`);
      }
      if (d.type === 'missing_column_in_A') {
        lines.push(`Table "${d.table}": column "${d.column}" exists in B but NOT in A (extra column — do NOT drop automatically, just note it)`);
      }
      if (d.type === 'column_mismatch') {
        lines.push(`Table "${d.table}", column "${d.column}" — the following properties differ (A is correct):`);
        d.issues.forEach(iss => {
          lines.push(`  - ${iss.field}: B has "${iss.B ?? 'null'}", A has "${iss.A ?? 'null'}" → update B to match A`);
        });
      }
    });
    lines.push(``);
  }

  // Functions
  if (diff.functionDifferences?.length) {
    lines.push(`--- FUNCTION DIFFERENCES ---`);
    diff.functionDifferences.forEach(f => {
      lines.push(``);
      if (f.type === 'missing_in_B') {
        lines.push(`Function "${f.name}" is MISSING in B. Create it using this definition from A:`);
        lines.push(f.definitionA || '(definition unavailable)');
      }
      if (f.type === 'body_mismatch') {
        lines.push(`Function "${f.name}" exists in both but body differs. Replace B with A's version:`);
        lines.push(`A definition:`);
        lines.push(f.definitionA || '(unavailable)');
        lines.push(`B definition (current):`);
        lines.push(f.definitionB || '(unavailable)');
      }
      if (f.type === 'missing_in_A') {
        lines.push(`Function "${f.name}" exists in B but NOT in A (extra — do NOT drop automatically, just note it)`);
      }
    });
    lines.push(``);
  }

  // Triggers
  if (diff.triggerDifferences?.length) {
    lines.push(`--- TRIGGER DIFFERENCES ---`);
    diff.triggerDifferences.forEach(t => {
      lines.push(``);
      if (t.type === 'missing_in_B') {
        const d = t.detailsA;
        lines.push(`Trigger "${d?.trigger_name}" on table "${d?.table_name}" is MISSING in B.`);
        lines.push(`  Timing: ${d?.action_timing} ${d?.event_manipulation}`);
        lines.push(`  Action: ${d?.action_statement}`);
        if (d?.function_definition) {
          lines.push(`  Trigger function definition from A:`);
          lines.push(d.function_definition);
        }
      }
      if (t.type === 'trigger_mismatch') {
        lines.push(`Trigger "${t.name}" exists in both but differs:`);
        t.issues.forEach(iss => {
          if (iss.field === 'function_definition') {
            lines.push(`  - function body differs. A's version is correct.`);
            lines.push(`  A: ${iss.A?.slice(0, 300) || '(unavailable)'}`);
          } else {
            lines.push(`  - ${iss.field}: B="${iss.B}", A="${iss.A}" → update B to match A`);
          }
        });
      }
      if (t.type === 'missing_in_A') {
        lines.push(`Trigger "${t.name}" exists in B but NOT in A (extra — do NOT drop automatically, just note it)`);
      }
    });
    lines.push(``);
  }

  // Sequences
  if (diff.sequenceDifferences?.length) {
    lines.push(`--- SEQUENCE DIFFERENCES ---`);
    diff.sequenceDifferences.forEach(s => {
      lines.push(``);
      if (s.type === 'missing_in_B') {
        const d = s.detailsA;
        lines.push(`Sequence "${s.name}" is MISSING in B. Create it:`);
        lines.push(`  data_type: ${d.data_type}, start: ${d.start_value}, increment: ${d.increment}, min: ${d.minimum_value}, max: ${d.maximum_value}, cache: ${d.cache_size}, cycle: ${d.cycle_option}`);
        if (d.owned_by_table) lines.push(`  OWNED BY ${d.owned_by_table}.${d.owned_by_column}`);
      }
      if (s.type === 'sequence_mismatch') {
        lines.push(`Sequence "${s.name}" exists in both but differs:`);
        s.issues.forEach(iss => lines.push(`  - ${iss.field}: B="${iss.B}", A="${iss.A}" → update B to match A`));
      }
      if (s.type === 'missing_in_A') {
        lines.push(`Sequence "${s.name}" exists in B but NOT in A (extra — do NOT drop automatically)`);
      }
    });
    lines.push(``);
  }

  lines.push(`=== END OF DIFFERENCES ===`);
  lines.push(``);
  lines.push(`Please generate the full migration SQL script now. Wrap each logical section in a comment block.`);

  return lines.join('\n');
};

export const handleExecuteSync = async (req, res) => {
  const { dbTarget, sqlCommands } = req.body;
  
  const client = new pg.Client({ ...dbTarget, ssl: false });
  try {
    await client.connect();
    
    const results = [];
    for (const cmd of sqlCommands) {
      try {
        await client.query(cmd.sql);
        results.push({ sql: cmd.sql, status: 'success' });
      } catch (e) {
        results.push({ sql: cmd.sql, status: 'error', error: e.message });
      }
    }
    
    await client.end();
    res.json({ success: true, results });
  } catch (error) {
    if (client) await client.end();
    res.status(500).json({ success: false, error: error.message });
  }
};
