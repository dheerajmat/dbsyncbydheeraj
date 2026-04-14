import React, { useState } from 'react';
import axios from 'axios';
import {
  Database, RefreshCw, CheckCircle2, AlertCircle, Code, Play,
  Columns, Zap, GitBranch, ClipboardCopy, ArrowLeftRight,
  Hash, ChevronDown, ChevronUp, Shield
} from 'lucide-react';

const API_BASE = 'http://localhost:5000/api/compare';

const InputField = ({ label, type = 'text', value, onChange, placeholder }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</label>
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600
                 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/40 transition-all"
    />
  </div>
);

const DbForm = ({ label, tag, tagColor, config, setConfig }) => (
  <div className="flex-1 min-w-0">
    <div className="flex items-center gap-2 mb-3">
      <Database className="w-4 h-4 text-slate-400" />
      <span className="text-sm font-semibold text-slate-300">{label}</span>
      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tagColor}`}>{tag}</span>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <InputField label="Host" value={config.host} placeholder="localhost"
          onChange={e => setConfig({ ...config, host: e.target.value })} />
      </div>
      <InputField label="Port" type="number" value={config.port} placeholder="5432"
        onChange={e => setConfig({ ...config, port: e.target.value })} />
      <InputField label="Database" value={config.database} placeholder="my_database"
        onChange={e => setConfig({ ...config, database: e.target.value })} />
      <InputField label="User" value={config.user} placeholder="postgres"
        onChange={e => setConfig({ ...config, user: e.target.value })} />
      <InputField label="Password" type="password" value={config.password} placeholder="••••••••"
        onChange={e => setConfig({ ...config, password: e.target.value })} />
    </div>
  </div>
);

const Badge = ({ label, variant }) => {
  const styles = {
    red: 'bg-rose-500/15 text-rose-400 border border-rose-500/20',
    amber: 'bg-amber-500/15 text-amber-400 border border-amber-500/20',
    orange: 'bg-orange-500/15 text-orange-400 border border-orange-500/20',
    blue: 'bg-sky-500/15 text-sky-400 border border-sky-500/20',
  };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${styles[variant] || styles.blue}`}>{label}</span>;
};

const Collapsible = ({ icon, title, count, variant, children }) => {
  const [open, setOpen] = useState(true);
  const dotColor = { red: 'bg-rose-400', amber: 'bg-amber-400', orange: 'bg-orange-400', green: 'bg-emerald-400' };
  return (
    <div className="bg-slate-900/60 rounded-xl border border-slate-800 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          <span className={`w-2 h-2 rounded-full ${count === 0 ? 'bg-emerald-400' : (dotColor[variant] || 'bg-sky-400')}`} />
          {icon}
          {title}
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ml-1 ${count === 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-700 text-slate-300'}`}>
            {count}
          </span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>
      {open && <div className="px-4 pb-4 pt-1 max-h-72 overflow-y-auto space-y-2">{children}</div>}
    </div>
  );
};

const EmptyState = ({ msg }) => (
  <div className="flex items-center gap-2 text-sm text-emerald-500/70 py-1">
    <CheckCircle2 className="w-4 h-4" /> {msg}
  </div>
);

const DiffRow = ({ table, column, badge, issues }) => (
  <div className="bg-slate-800/60 rounded-lg p-3 border border-slate-700/50">
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-bold text-sky-400">{table}</span>
      {column && <><span className="text-slate-600">·</span><code className="text-xs bg-slate-700/80 px-1.5 py-0.5 rounded text-slate-300">{column}</code></>}
      {badge}
    </div>
    {issues?.length > 0 && (
      <div className="mt-2 space-y-1 pl-1 border-l-2 border-slate-700">
        {issues.map((iss, j) => (
          <div key={j} className="text-xs flex items-center gap-2 text-slate-400">
            <span className="text-slate-600 w-32 shrink-0 truncate">{iss.field}</span>
            <span className="text-rose-400">{String(iss.B ?? 'null')}</span>
            <span className="text-slate-600">→</span>
            <span className="text-emerald-400">{String(iss.A ?? 'null')}</span>
          </div>
        ))}
      </div>
    )}
  </div>
);

function App() {
  const [dbA, setDbA] = useState({ host: 'localhost', port: 5432, database: '', user: 'postgres', password: '' });
  const [dbB, setDbB] = useState({ host: 'localhost', port: 5432, database: '', user: 'postgres', password: '' });
  const [loading, setLoading] = useState(false);
  const [diffResult, setDiffResult] = useState(null);
  const [sqlCommands, setSqlCommands] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);
  const [promptText, setPromptText] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);

  const handleSwap = () => { setDbA(dbB); setDbB(dbA); setDiffResult(null); setSqlCommands([]); };

  const handleCompare = async () => {
    setLoading(true); setDiffResult(null); setSqlCommands([]); setSyncStatus(null); setPromptText('');
    try {
      const res = await axios.post(`${API_BASE}/direct`, { dbA, dbB });
      setDiffResult(res.data);
    } catch (err) {
      alert('Comparison failed: ' + (err.response?.data?.error || err.message));
    } finally { setLoading(false); }
  };

  const handleGenerateSQL = async () => {
    try {
      const res = await axios.post(`${API_BASE}/generate-sql`, { diff: diffResult.diff, schemaA: diffResult.schemaA });
      setSqlCommands(res.data.sqlCommands);
    } catch (err) { alert('SQL Generation failed: ' + (err.response?.data?.error || err.message)); }
  };

  const handleGeneratePrompt = async () => {
    try {
      const res = await axios.post(`${API_BASE}/generate-prompt`, {
        diff: diffResult.diff, schemaA: diffResult.schemaA,
        dbAName: dbA.database, dbBName: dbB.database
      });
      setPromptText(res.data.prompt);
      await navigator.clipboard.writeText(res.data.prompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 3000);
    } catch (err) { alert('Prompt generation failed: ' + (err.response?.data?.error || err.message)); }
  };

  const handleExecuteSync = async () => {
    if (!confirm('Execute these changes on Target DB (B)?')) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/execute`, { dbTarget: dbB, sqlCommands });
      setSyncStatus(res.data.results);
    } catch { alert('Sync failed'); } finally { setLoading(false); }
  };

  const diff = diffResult?.diff;
  const totalIssues = diff
    ? diff.missingTablesInB.length + diff.missingTablesInA.length +
      diff.columnDifferences.length + (diff.functionDifferences?.length || 0) +
      (diff.triggerDifferences?.length || 0) + (diff.sequenceDifferences?.length || 0)
    : 0;

  return (
    <div className="min-h-screen bg-[#080d18]">
      {/* Top nav bar */}
      <div className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="text-white font-bold text-sm">DB Sync Engine</span>
              <span className="text-slate-500 text-xs ml-2">PostgreSQL Schema Comparator</span>
            </div>
          </div>
          <button onClick={handleCompare} disabled={loading}
            className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed
                       text-white text-sm font-semibold py-2 px-5 rounded-lg transition-all shadow-lg shadow-sky-900/30">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Comparing...' : 'Run Comparison'}
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        {/* Connection panel */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-5">Database Connections</p>
          <div className="flex items-start gap-4">
            <DbForm label="Source Database" tag="A · Reference" tagColor="bg-sky-500/15 text-sky-400 border border-sky-500/20"
              config={dbA} setConfig={setDbA} />

            {/* Swap button */}
            <div className="flex flex-col items-center justify-center pt-8 shrink-0">
              <button onClick={handleSwap}
                title="Swap A ↔ B"
                className="group w-10 h-10 rounded-full bg-slate-800 border border-slate-700 hover:border-sky-500
                           hover:bg-sky-500/10 flex items-center justify-center transition-all shadow-md">
                <ArrowLeftRight className="w-4 h-4 text-slate-400 group-hover:text-sky-400 transition-colors" />
              </button>
              <span className="text-xs text-slate-600 mt-1.5">swap</span>
            </div>

            <DbForm label="Target Database" tag="B · To Update" tagColor="bg-violet-500/15 text-violet-400 border border-violet-500/20"
              config={dbB} setConfig={setDbB} />
          </div>
        </div>

        {/* Results */}
        {diff && (
          <div className="space-y-5">
            {/* Summary bar */}
            <div className="flex items-center justify-between bg-slate-900/50 border border-slate-800 rounded-xl px-5 py-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-300">Comparison Results</span>
                <span className="text-xs text-slate-500">{dbA.database} → {dbB.database}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-bold px-3 py-1 rounded-full border ${
                  totalIssues === 0
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                }`}>
                  {totalIssues === 0 ? '✓ Schemas in sync' : `${totalIssues} difference${totalIssues > 1 ? 's' : ''} found`}
                </span>
                <button onClick={handleGeneratePrompt}
                  className="flex items-center gap-1.5 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30
                             text-violet-300 text-xs font-semibold py-1.5 px-3 rounded-lg transition-all">
                  <ClipboardCopy className="w-3.5 h-3.5" />
                  {promptCopied ? '✓ Copied!' : 'Copy AI Prompt'}
                </button>
                <button onClick={handleGenerateSQL}
                  className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600
                             text-slate-200 text-xs font-semibold py-1.5 px-3 rounded-lg transition-all">
                  <Code className="w-3.5 h-3.5" />
                  Generate SQL
                </button>
              </div>
            </div>

            {/* Diff grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Tables */}
              <Collapsible icon={<span className="text-xs">⬛</span>} title="Tables"
                count={diff.missingTablesInB.length + diff.missingTablesInA.length} variant="red">
                {diff.missingTablesInB.length === 0 && diff.missingTablesInA.length === 0
                  ? <EmptyState msg="All tables match" />
                  : <>
                    {diff.missingTablesInB.map(t => (
                      <DiffRow key={t} table={t} badge={<Badge label="Missing in B" variant="red" />} />
                    ))}
                    {diff.missingTablesInA.map(t => (
                      <DiffRow key={t} table={t} badge={<Badge label="Extra in B" variant="amber" />} />
                    ))}
                  </>
                }
              </Collapsible>

              {/* Columns */}
              <Collapsible icon={<Columns className="w-3.5 h-3.5" />} title="Columns"
                count={diff.columnDifferences.length} variant="red">
                {diff.columnDifferences.length === 0
                  ? <EmptyState msg="All columns match" />
                  : diff.columnDifferences.map((d, i) => (
                    <DiffRow key={i} table={d.table} column={d.column}
                      badge={
                        d.type === 'missing_column_in_B' ? <Badge label="Missing in B" variant="red" /> :
                        d.type === 'missing_column_in_A' ? <Badge label="Extra in B" variant="amber" /> :
                        <Badge label="Mismatch" variant="orange" />
                      }
                      issues={d.type === 'column_mismatch' ? d.issues : null}
                    />
                  ))
                }
              </Collapsible>

              {/* Sequences */}
              <Collapsible icon={<Hash className="w-3.5 h-3.5" />} title="Sequences"
                count={diff.sequenceDifferences?.length || 0} variant="amber">
                {(diff.sequenceDifferences?.length || 0) === 0
                  ? <EmptyState msg="All sequences match" />
                  : diff.sequenceDifferences.map((s, i) => (
                    <DiffRow key={i} table={s.name}
                      badge={
                        s.type === 'missing_in_B' ? <Badge label="Missing in B" variant="red" /> :
                        s.type === 'missing_in_A' ? <Badge label="Extra in B" variant="amber" /> :
                        <Badge label="Mismatch" variant="orange" />
                      }
                      issues={s.type === 'sequence_mismatch' ? s.issues : null}
                    />
                  ))
                }
              </Collapsible>

              {/* Functions */}
              <Collapsible icon={<Zap className="w-3.5 h-3.5" />} title="Functions"
                count={diff.functionDifferences?.length || 0} variant="orange">
                {(diff.functionDifferences?.length || 0) === 0
                  ? <EmptyState msg="All functions match" />
                  : diff.functionDifferences.map((f, i) => (
                    <DiffRow key={i} table={f.name}
                      badge={
                        f.type === 'missing_in_B' ? <Badge label="Missing in B" variant="red" /> :
                        f.type === 'missing_in_A' ? <Badge label="Extra in B" variant="amber" /> :
                        <Badge label="Body Mismatch" variant="orange" />
                      }
                    />
                  ))
                }
              </Collapsible>

              {/* Triggers */}
              <Collapsible icon={<GitBranch className="w-3.5 h-3.5" />} title="Triggers"
                count={diff.triggerDifferences?.length || 0} variant="orange">
                {(diff.triggerDifferences?.length || 0) === 0
                  ? <EmptyState msg="All triggers match" />
                  : diff.triggerDifferences.map((t, i) => (
                    <DiffRow key={i} table={t.name}
                      badge={
                        t.type === 'missing_in_B' ? <Badge label="Missing in B" variant="red" /> :
                        t.type === 'missing_in_A' ? <Badge label="Extra in B" variant="amber" /> :
                        <Badge label="Mismatch" variant="orange" />
                      }
                      issues={t.type === 'trigger_mismatch' ? t.issues.filter(i => i.field !== 'function_definition') : null}
                    />
                  ))
                }
              </Collapsible>
            </div>

            {/* SQL Panel */}
            {sqlCommands.length > 0 && (
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Play className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-semibold text-slate-200">Generated SQL</span>
                    <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">{sqlCommands.length} statements</span>
                  </div>
                  <button onClick={handleExecuteSync} disabled={loading}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40
                               text-white text-sm font-semibold py-2 px-5 rounded-lg transition-all">
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Execute on B
                  </button>
                </div>
                <div className="bg-[#050a12] p-5 font-mono text-sm text-emerald-300 max-h-[480px] overflow-y-auto">
                  {sqlCommands.map((cmd, i) => (
                    <div key={i} className="mb-5 last:mb-0">
                      <div className="text-slate-600 text-xs mb-1.5">
                        -- [{cmd.type}]{cmd.table || cmd.name ? ` · ${cmd.table || cmd.name}` : ''}{cmd.column ? `.${cmd.column}` : ''}{cmd.comment ? ` · ${cmd.comment}` : ''}
                      </div>
                      <pre className="whitespace-pre-wrap break-all leading-relaxed">{cmd.sql}</pre>
                      {syncStatus?.[i] && (
                        <div className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${syncStatus[i].status === 'success' ? 'text-emerald-500' : 'text-rose-400'}`}>
                          {syncStatus[i].status === 'success'
                            ? <><CheckCircle2 className="w-3.5 h-3.5" /> Applied successfully</>
                            : <><AlertCircle className="w-3.5 h-3.5" /> {syncStatus[i].error}</>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Prompt Panel */}
            {promptText && (
              <div className="bg-slate-900/50 border border-violet-900/40 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-violet-900/30 bg-violet-950/20">
                  <div className="flex items-center gap-2">
                    <ClipboardCopy className="w-4 h-4 text-violet-400" />
                    <span className="text-sm font-semibold text-slate-200">AI Prompt</span>
                    <span className="text-xs text-slate-500">Paste into ChatGPT / Claude to get a migration script</span>
                  </div>
                  <button onClick={async () => {
                    await navigator.clipboard.writeText(promptText);
                    setPromptCopied(true);
                    setTimeout(() => setPromptCopied(false), 3000);
                  }} className="flex items-center gap-1.5 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30
                               text-violet-300 text-xs font-semibold py-1.5 px-3 rounded-lg transition-all">
                    <ClipboardCopy className="w-3.5 h-3.5" />
                    {promptCopied ? '✓ Copied!' : 'Copy'}
                  </button>
                </div>
                <pre className="p-5 text-xs text-violet-200/80 max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words font-mono leading-relaxed bg-[#050a12]">
                  {promptText}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
