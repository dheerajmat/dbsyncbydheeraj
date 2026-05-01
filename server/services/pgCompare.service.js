import pg from 'pg';

export const getSchema = async (config) => {
  const { host, port, user, password, database } = config;
  const client = new pg.Client({ host, port, user, password, database, ssl: false });

  try {
    await client.connect();

    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);

    const columnsRes = await client.query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default,
             character_maximum_length, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);

    const constraintsRes = await client.query(`
      SELECT tc.table_name, kcu.column_name, tc.constraint_type, tc.constraint_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
    `);

    // Fetch functions (including trigger functions)
    const functionsRes = await client.query(`
      SELECT p.proname AS function_name,
             pg_get_function_identity_arguments(p.oid) AS arguments,
             pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prokind = 'f'
    `);

    // Fetch triggers and aggregate events (e.g., INSERT OR UPDATE)
    const triggersRes = await client.query(`
      SELECT t.trigger_name, t.event_object_table AS table_name,
             string_agg(t.event_manipulation, ' OR ') as event_manipulation,
             MAX(t.action_timing) as action_timing,
             MAX(t.action_statement) as action_statement,
             MAX(t.action_condition) as action_condition,
             MAX(t.action_orientation) as action_orientation,
             MAX(p.proname) AS function_name
      FROM information_schema.triggers t
      JOIN pg_trigger pt ON pt.tgname = t.trigger_name
      JOIN pg_class c ON pt.tgrelid = c.oid AND c.relname = t.event_object_table
      JOIN pg_proc p ON p.oid = pt.tgfoid
      WHERE t.trigger_schema = 'public'
        AND NOT pt.tgisinternal
      GROUP BY t.trigger_name, t.event_object_table
    `);

    // Fetch sequences with full config
    const sequencesRes = await client.query(`
      SELECT s.sequence_name,
             s.data_type,
             s.start_value,
             s.minimum_value,
             s.maximum_value,
             s.increment,
             s.cycle_option,
             pg_sequence.seqcache AS cache_size,
             d.refobjid::regclass::text AS owned_by_table,
             a.attname AS owned_by_column
      FROM information_schema.sequences s
      JOIN pg_class c ON c.relname = s.sequence_name AND c.relkind = 'S'
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_sequence ON pg_sequence.seqrelid = c.oid
      LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a'
      LEFT JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
      WHERE s.sequence_schema = 'public'
    `);

    await client.end();

    return {
      tables: tablesRes.rows,
      columns: columnsRes.rows,
      constraints: constraintsRes.rows,
      functions: functionsRes.rows,
      triggers: triggersRes.rows,
      sequences: sequencesRes.rows
    };
  } catch (error) {
    if (client) await client.end();
    throw error;
  }
};
