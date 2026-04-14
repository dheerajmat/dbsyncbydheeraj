export const compareSchemas = (schemaA, schemaB) => {
  const diff = {
    missingTablesInB: [],
    missingTablesInA: [],
    columnDifferences: [],
    constraintDifferences: [],
    functionDifferences: [],
    triggerDifferences: [],
    sequenceDifferences: []
  };

  const tablesA = schemaA.tables.map(t => t.table_name);
  const tablesB = schemaB.tables.map(t => t.table_name);

  diff.missingTablesInB = tablesA.filter(t => !tablesB.includes(t));
  diff.missingTablesInA = tablesB.filter(t => !tablesA.includes(t));

  // --- Column comparison ---
  const colKey = c => `${c.table_name}.${c.column_name}`;

  schemaA.columns.forEach(colA => {
    if (!tablesB.includes(colA.table_name)) return;
    const colB = schemaB.columns.find(
      c => c.table_name === colA.table_name && c.column_name === colA.column_name
    );

    if (!colB) {
      diff.columnDifferences.push({
        type: 'missing_column_in_B',
        table: colA.table_name,
        column: colA.column_name,
        details: colA
      });
      return;
    }

    const issues = [];
    if (colA.data_type !== colB.data_type)
      issues.push({ field: 'data_type', A: colA.data_type, B: colB.data_type });
    if (colA.is_nullable !== colB.is_nullable)
      issues.push({ field: 'is_nullable', A: colA.is_nullable, B: colB.is_nullable });
    if ((colA.character_maximum_length ?? null) !== (colB.character_maximum_length ?? null))
      issues.push({ field: 'character_maximum_length', A: colA.character_maximum_length, B: colB.character_maximum_length });
    if ((colA.numeric_precision ?? null) !== (colB.numeric_precision ?? null))
      issues.push({ field: 'numeric_precision', A: colA.numeric_precision, B: colB.numeric_precision });
    if ((colA.numeric_scale ?? null) !== (colB.numeric_scale ?? null))
      issues.push({ field: 'numeric_scale', A: colA.numeric_scale, B: colB.numeric_scale });
    if ((colA.column_default ?? null) !== (colB.column_default ?? null))
      issues.push({ field: 'column_default', A: colA.column_default, B: colB.column_default });

    if (issues.length > 0) {
      diff.columnDifferences.push({
        type: 'column_mismatch',
        table: colA.table_name,
        column: colA.column_name,
        issues,
        detailsA: colA,
        detailsB: colB
      });
    }
  });

  // Columns in B missing from A
  schemaB.columns.forEach(colB => {
    if (!tablesA.includes(colB.table_name)) return;
    const exists = schemaA.columns.find(
      c => c.table_name === colB.table_name && c.column_name === colB.column_name
    );
    if (!exists) {
      diff.columnDifferences.push({
        type: 'missing_column_in_A',
        table: colB.table_name,
        column: colB.column_name,
        details: colB
      });
    }
  });

  // --- Function comparison ---
  const funcsA = schemaA.functions || [];
  const funcsB = schemaB.functions || [];
  const funcKey = f => `${f.function_name}(${f.arguments})`;

  funcsA.forEach(fA => {
    const fB = funcsB.find(f => funcKey(f) === funcKey(fA));
    if (!fB) {
      diff.functionDifferences.push({ type: 'missing_in_B', name: funcKey(fA), definitionA: fA.definition });
    } else if (normalizeBody(fA.definition) !== normalizeBody(fB.definition)) {
      diff.functionDifferences.push({ type: 'body_mismatch', name: funcKey(fA), definitionA: fA.definition, definitionB: fB.definition });
    }
  });

  funcsB.forEach(fB => {
    const exists = funcsA.find(f => funcKey(f) === funcKey(fB));
    if (!exists) {
      diff.functionDifferences.push({ type: 'missing_in_A', name: funcKey(fB), definitionB: fB.definition });
    }
  });

  // --- Trigger comparison ---
  const trigsA = schemaA.triggers || [];
  const trigsB = schemaB.triggers || [];
  const trigKey = t => `${t.table_name}.${t.trigger_name}`;

  trigsA.forEach(tA => {
    const tB = trigsB.find(t => trigKey(t) === trigKey(tA));
    if (!tB) {
      diff.triggerDifferences.push({ type: 'missing_in_B', name: trigKey(tA), detailsA: tA });
    } else {
      const issues = [];
      if (tA.event_manipulation !== tB.event_manipulation)
        issues.push({ field: 'event_manipulation', A: tA.event_manipulation, B: tB.event_manipulation });
      if (tA.action_timing !== tB.action_timing)
        issues.push({ field: 'action_timing', A: tA.action_timing, B: tB.action_timing });
      if (normalizeBody(tA.function_definition) !== normalizeBody(tB.function_definition))
        issues.push({ field: 'function_definition', A: tA.function_definition, B: tB.function_definition });
      if (issues.length > 0)
        diff.triggerDifferences.push({ type: 'trigger_mismatch', name: trigKey(tA), issues, detailsA: tA, detailsB: tB });
    }
  });

  trigsB.forEach(tB => {
    const exists = trigsA.find(t => trigKey(t) === trigKey(tB));
    if (!exists)
      diff.triggerDifferences.push({ type: 'missing_in_A', name: trigKey(tB), detailsB: tB });
  });

  // --- Sequence comparison ---
  const seqsA = schemaA.sequences || [];
  const seqsB = schemaB.sequences || [];

  seqsA.forEach(sA => {
    const sB = seqsB.find(s => s.sequence_name === sA.sequence_name);
    if (!sB) {
      diff.sequenceDifferences.push({ type: 'missing_in_B', name: sA.sequence_name, detailsA: sA });
    } else {
      const issues = [];
      for (const field of ['data_type', 'start_value', 'minimum_value', 'maximum_value', 'increment', 'cycle_option', 'cache_size']) {
        if (String(sA[field] ?? '') !== String(sB[field] ?? ''))
          issues.push({ field, A: sA[field], B: sB[field] });
      }
      if (issues.length > 0)
        diff.sequenceDifferences.push({ type: 'sequence_mismatch', name: sA.sequence_name, issues, detailsA: sA, detailsB: sB });
    }
  });

  seqsB.forEach(sB => {
    if (!seqsA.find(s => s.sequence_name === sB.sequence_name))
      diff.sequenceDifferences.push({ type: 'missing_in_A', name: sB.sequence_name, detailsB: sB });
  });

  return diff;
};

const normalizeBody = (str = '') => str.replace(/\s+/g, ' ').trim().toLowerCase();
