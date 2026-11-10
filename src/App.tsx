import {
  Activity, AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronRight,
  CircleHelp, Cpu, Download, ExternalLink, FileText, Gauge, HardDrive, HeartPulse,
  Layers3, LockKeyhole, MemoryStick, Play, RefreshCcw, Search,
  Settings2, ShieldCheck, Sparkles, Square, Trash2, Wifi, Wrench, X
} from 'lucide-react';
import { ActivityRings } from '@jonasdoesthings/react-activity-rings';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import logoUrl from './assets/wincleam-logo.png';
import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { bridge, desktop } from './bridge';
import { translations, translate, translateTask } from './i18n';
import type {
  BootstrapInfo, Category, DriveInfo, Language, MaintenanceEvent,
  SystemSnapshot, TaskDefinition, Theme
} from './model';
import { CATEGORIES, TASKS } from './model';

type IconType = LucideIcon;
const icons: Record<string, IconType> = {
  shield: ShieldCheck, search: Search, wrench: Wrench, layers: Layers3,
  settings: Settings2, trash: Trash2, 'hard-drive': HardDrive, wifi: Wifi,
  package: Layers3, download: Download, memory: MemoryStick
};
const categoryIcon: Record<Category, IconType> = {
  repair: ShieldCheck, cleanup: Sparkles, disk: HardDrive,
  network: Wifi, updates: Download, tools: MemoryStick
};

const THEMES: { id: Theme; colors: [string, string]; label: string }[] = [
  { id: 'system', colors: ['#f1f2f8', '#354367'], label: 'themesSystem' },
  { id: 'light', colors: ['#ffffff', '#6b8dff'], label: 'themesLight' },
  { id: 'dark', colors: ['#171b30', '#919afd'], label: 'themesDark' },
  { id: 'ember', colors: ['#181015', '#ff365e'], label: 'themesEmber' },
  { id: 'neon', colors: ['#221638', '#70ffb2'], label: 'themesNeon' }
];
const RING_COLORS: Record<string, [string, string, string]> = {
  light: ['#ff5c85', '#8e7ef4', '#2fcbbd'],
  dark: ['#fa547a', '#b28fff', '#5bdac7'],
  ember: ['#ff3157', '#ff8a48', '#ffcc74'],
  neon: ['#be79ff', '#63ffc3', '#8e9fff']
};

function getPreference<T extends string>(key: string, fallback: T, valid: readonly T[]): T {
  try {
    const value = localStorage.getItem('wincleam-' + key) as T;
    return valid.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  return (bytes / (1024 ** 3)).toFixed(1) + ' GB';
}

const baseSnapshot: SystemSnapshot = {
  cpuPercent: 0, memoryTotal: 0, memoryUsed: 0, cpuCount: 0, osName: 'Windows'
};

type GitHubRelease = { tag_name?: string; html_url?: string; prerelease?: boolean; draft?: boolean };

function isNewerRelease(tag: string, current: string): boolean {
  const numbers = (value: string) => value.replace(/^v/i, '').split('.').map(part => Number.parseInt(part, 10) || 0);
  const [a, b, c] = numbers(tag);
  const [x, y, z] = numbers(current);
  return a > x || (a === x && (b > y || (b === y && c > z)));
}

function Logo() {
  return (
    <div className="logo-mark" aria-hidden="true">
      <img src={logoUrl} alt="" />
    </div>
  );
}

function StatPill({ icon, text, variant }: { icon: ReactNode; text: string; variant?: string }) {
  return <span className={`stat-pill ${variant || ''}`}>{icon}{text}</span>;
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => getPreference('theme', 'system', THEMES.map(x => x.id)));
  const [lang, setLang] = useState<Language>(() => {
    const browser = navigator.language.slice(0, 2) as Language;
    return getPreference('language', ['pt', 'en', 'es', 'ru', 'zh'].includes(browser) ? browser : 'pt',
      ['pt', 'en', 'es', 'ru', 'zh']);
  });
  const [actualTheme, setActualTheme] = useState<'light' | 'dark'>('dark');
  const [bootstrap, setBootstrap] = useState<BootstrapInfo | null>(null);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [diskTarget, setDiskTarget] = useState('all');
  const [stats, setStats] = useState<SystemSnapshot>(baseSnapshot);
  const [selected, setSelected] = useState<Set<string>>(() =>
    new Set(TASKS.filter(task => task.recommended).map(task => task.id))
  );
  const [filter, setFilter] = useState('');
  const [running, setRunning] = useState(false);
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [step, setStep] = useState({ current: 0, total: 0 });
  const [finished, setFinished] = useState(0);
  const [total, setTotal] = useState(0);
  const [outcomes, setOutcomes] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<{ completed: number; failed: number; skipped: number } | null>(null);
  const [logs, setLogs] = useState<{ id: number; content: string; taskId: string }[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [repairConfirmed, setRepairConfirmed] = useState(false);
  const [notice, setNotice] = useState('');
  const [currentSection, setCurrentSection] = useState('overview');
  const [showSettings, setShowSettings] = useState(false);
  const [availableRelease, setAvailableRelease] = useState<string | null>(null);
  const logCounter = useRef(0);
  const logEnd = useRef<HTMLDivElement | null>(null);

  const t = useCallback((key: string, values?: Record<string, string | number>) =>
    translate(lang, key, values), [lang]);
  const taskName = useCallback((id: string) => translateTask(lang, id)[0], [lang]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      const resolved: 'light' | 'dark' = theme === 'system' ? (media.matches ? 'dark' : 'light')
        : theme === 'light' ? 'light' : 'dark';
      setActualTheme(resolved);
      document.documentElement.dataset.theme = theme === 'system' ? resolved : theme;
    };
    update();
    media.addEventListener('change', update);
    localStorage.setItem('wincleam-theme', theme);
    return () => media.removeEventListener('change', update);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = ({ pt: 'pt-BR', en: 'en-GB', es: 'es-ES', ru: 'ru-RU', zh: 'zh-Hans-CN' })[lang];
    localStorage.setItem('wincleam-language', lang);
  }, [lang]);

  useEffect(() => {
    let mounted = true;
    bridge.bootstrap().then(data => { if (mounted) setBootstrap(data); }).catch(console.error);
    bridge.drives().then(items => {
      if (!mounted) return;
      setDrives(items);
      const systemDrive = items.find(item => item.letter === 'C:') || items[0];
      setDiskTarget(systemDrive?.letter || 'all');
    }).catch(console.error);
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!bootstrap?.version) return;
    const controller = new AbortController();
    void fetch('https://api.github.com/repos/RaphaelTW/WinCleam/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal
    })
      .then(response => response.ok ? response.json() as Promise<GitHubRelease> : null)
      .then(release => {
        if (release?.tag_name && !release.draft && !release.prerelease && isNewerRelease(release.tag_name, bootstrap.version)) {
          setAvailableRelease(release.tag_name);
        }
      })
      .catch(() => { /* An update check must never affect maintenance. */ });
    return () => controller.abort();
  }, [bootstrap?.version]);

  useEffect(() => {
    let alive = true;
    const poll = () => bridge.snapshot()
      .then(data => { if (alive) setStats(data); })
      .catch(() => { /* Monitoring must never block maintenance. */ });
    void poll();
    const timer = window.setInterval(poll, 2200);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  const handleEvent = useCallback((event: MaintenanceEvent) => {
    switch (event.kind) {
      case 'run-start':
        setRunning(true);
        setResults(null);
        setTotal(event.total || event.ids?.length || 0);
        setFinished(0);
        setOutcomes({});
        setLogs([]);
        setActiveTask(null);
        break;
      case 'task-start':
        setActiveTask(event.taskId || null);
        setProgress(null);
        setStep({ current: 1, total: 1 });
        break;
      case 'step':
        setStep({ current: event.step || 1, total: event.total || 1 });
        setProgress(null);
        break;
      case 'progress':
        setProgress(event.percent ?? null);
        break;
      case 'log':
        setLogs(current => [...current.slice(-299), {
          id: ++logCounter.current,
          content: event.message || '',
          taskId: event.taskId || ''
        }]);
        break;
      case 'task-end':
        setFinished(value => value + 1);
        setOutcomes(current => ({ ...current, [event.taskId || '']: !!event.ok }));
        setActiveTask(null);
        setProgress(null);
        break;
      case 'run-end':
        setRunning(false);
        setActiveTask(null);
        setProgress(null);
        setResults({
          completed: event.completed || 0,
          failed: event.failed || 0,
          skipped: event.skipped || 0
        });
        break;
    }
  }, []);

  useEffect(() => {
    let closed = false;
    let unlisten: (() => void) | undefined;
    void bridge.listen(handleEvent).then(cleanup => {
      if (closed) cleanup();
      else unlisten = cleanup;
    });
    return () => { closed = true; unlisten?.(); };
  }, [handleEvent]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggleTask = (id: string) => {
    if (running) return;
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const taskIds = useMemo(() => TASKS.filter(task => selected.has(task.id)).map(task => task.id), [selected]);
  const warnings = useMemo(() => [...new Set(TASKS
    .filter(task => selected.has(task.id) && task.warning)
    .map(task => task.warning!))], [selected]);
  const showTask = (task: TaskDefinition) => {
    const words = filter.trim().toLowerCase();
    return !words || [task.command, ...translateTask(lang, task.id)]
      .some(text => text.toLowerCase().includes(words));
  };

  const ringColors = RING_COLORS[theme === 'system' ? actualTheme : theme];
  const memoryRatio = stats.memoryTotal > 0 ? Math.min(1, stats.memoryUsed / stats.memoryTotal) : 0;
  const cpuRatio = Math.min(1, Math.max(0, stats.cpuPercent / 100));
  const queueRatio = total > 0 ? Math.min(1, finished / total) : 0;
  const cardRingData = [
    { filledPercentage: cpuRatio, color: ringColors[0], ringWidth: 13 },
    { filledPercentage: memoryRatio, color: ringColors[1], ringWidth: 13 },
    { filledPercentage: queueRatio, color: ringColors[2], ringWidth: 13 }
  ];

  const runSelected = () => {
    if (!taskIds.length) return setNotice(t('noSelection'));
    if (!desktop) return setNotice(t('previewOnly'));
    if (!bootstrap?.isAdmin) return setNotice(t('noAdmin'));
    setRepairConfirmed(false);
    setShowConfirm(true);
  };

  const begin = async () => {
    if (selected.has('chkdsk-f') && !repairConfirmed) return;
    setShowConfirm(false);
    try {
      await bridge.start({
        ids: taskIds,
        diskTarget,
        repairAcknowledged: repairConfirmed,
        locale: lang
      });
    } catch (error) {
      setNotice(t('error', { message: String(error) }));
    }
  };

  const updateDrives = async () => {
    try {
      const next = await bridge.drives();
      setDrives(next);
      if (diskTarget !== 'all' && !next.some(drive => drive.letter === diskTarget)) {
        setDiskTarget(next[0]?.letter || 'all');
      }
    } catch (error) { setNotice(t('error', { message: String(error) })); }
  };

  const chooseTool = async (tool: 'rammap' | 'lasso') => {
    try {
      const path = await bridge.chooseTool(tool);
      if (path) setBootstrap(current => current ? ({
        ...current,
        preferences: { ...current.preferences,
          [tool === 'rammap' ? 'rammapPath' : 'lassoPath']: path }
      }) : current);
    } catch (error) { setNotice(t('error', { message: String(error) })); }
  };

  const openTool = async (tool: 'rammap' | 'lasso') => {
    try { await bridge.openTool(tool); }
    catch (error) { setNotice(t('error', { message: String(error) })); }
  };

  const openSettings = async (target: 'drivers' | 'updates') => {
    try { await bridge.windowsSettings(target); }
    catch (error) { setNotice(t('error', { message: String(error) })); }
  };

  const scrollTo = (id: string) => {
    setCurrentSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const sectionName: Record<Category, string> = {
    repair: 'sectionRepair', cleanup: 'sectionCleanup', disk: 'sectionDisk',
    network: 'sectionNetwork', updates: 'sectionUpdates', tools: 'sectionTools'
  };

  return (
    <div className="app">
      <div className="aura aura-a" aria-hidden="true" />
      <div className="aura aura-b" aria-hidden="true" />
      <div className="aura aura-c" aria-hidden="true" />

      <aside className="sidebar glass-surface">
        <div className="brand"><Logo /><div><strong>WinCleam</strong><small>MAINTENANCE STUDIO</small></div></div>
        <div className="nav-kicker">{t('section')}</div>
        <nav className="nav-list" aria-label={t('maintenance')}>
          <button className={`nav-entry ${currentSection === 'overview' ? 'active' : ''}`} onClick={() => scrollTo('overview')}>
            <Gauge size={19}/>{t('overview')}<ChevronRight className="nav-chevron" size={16}/>
          </button>
          {CATEGORIES.map(category => {
            const Icon = categoryIcon[category];
            return <button key={category} className={`nav-entry ${currentSection === category ? 'active' : ''}`}
              onClick={() => scrollTo(category)}><Icon size={19}/>{t(sectionName[category])}</button>;
          })}
          <button className={`nav-entry ${currentSection === 'execution' ? 'active' : ''}`} onClick={() => scrollTo('execution')}>
            <Activity size={19}/>{t('execution')}
          </button>
          <button className="nav-entry" onClick={() => setShowSettings(true)}>
            <Settings2 size={19}/>{t('preferences')}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className="settings-shortcut" onClick={() => setShowSettings(true)}><Settings2 size={16}/>{t('preferences')}</button>
          <div className="sidebar-signature">v{bootstrap?.version || '2.0.0'}</div>
        </div>
      </aside>

      <main className="content" id="overview">
        <header className="content-top">
          <div className="crumb"><span>{t('platform')}</span><ChevronRight size={14}/><strong>{t('home')}</strong></div>
          <div className="top-status">
            {availableRelease && <button className="update-button" onClick={async () => {
              try { await bridge.openLatestRelease(); }
              catch (error) { setNotice(t('error', { message: String(error) })); }
            }}><Download size={14}/>Atualizar {availableRelease}</button>}
            {!desktop && <span className="preview-pill"><CircleHelp size={14}/>{t('preview')}</span>}
            <span className={`admin-pill ${bootstrap?.isAdmin ? 'active' : 'inactive'}`}>
              <span className="pulse-dot"/>{t(bootstrap?.isAdmin ? 'adminYes' : 'adminNo')}
            </span>
          </div>
        </header>

        <section className="hero glass-panel">
          <div className="hero-copy">
            <div className="mini-eyebrow"><Sparkles size={15}/>{t('heroBadge')}</div>
            <h1>{t('heroTitle')}</h1>
            <p>{t('heroDescription')}</p>
            <div className="hero-actions">
              <button className="button button-primary" onClick={runSelected} disabled={running || !taskIds.length}>
                <Play size={15} fill="currentColor"/>{t('run')}<span className="counter">{taskIds.length}</span>
              </button>
              <button className="button button-outline" onClick={() => {
                setSelected(new Set(TASKS.filter(item => item.recommended).map(item => item.id)));
              }} disabled={running}>
                <Sparkles size={15}/>{t('selectRecommended')}
              </button>
            </div>
          </div>
          <div className="hero-ring">
            <div className="rings-wrap">
              <ActivityRings
                rings={cardRingData}
                options={{ containerHeight: '250px', containerWidth: '250px', initialRadius: 37,
                  paddingBetweenRings: 0.78, animationDurationMillis: 900, backgroundOpacity: 0.17 }}
              />
              <div className="rings-center" aria-hidden="true"><HeartPulse size={26}/><span>LIVE</span></div>
            </div>
            <div className="ring-legend">
              <span><i style={{ background: ringColors[0] }}/>{t('cpu')} <b>{Math.round(stats.cpuPercent)}%</b></span>
              <span><i style={{ background: ringColors[1] }}/>{t('memory')} <b>{Math.round(memoryRatio * 100)}%</b></span>
              <span><i style={{ background: ringColors[2] }}/>{t('operation')} <b>{Math.round(queueRatio * 100)}%</b></span>
            </div>
          </div>
        </section>

        <section className="quick-metrics">
          <div className="metric-tile glass-panel">
            <div className="metric-icon cpu-icon"><Cpu size={19}/></div>
            <div className="metric-copy"><span>{t('cpu')}</span><strong>{Math.round(stats.cpuPercent)}<small>%</small></strong>
              <em>{stats.cpuCount} {t('cores')}</em></div>
            <div className="tiny-bars" aria-hidden="true">
              {[38, 62, 47, 73, 56, 83, 51, 69, 42].map((height, i) => (
                <span key={i} style={{ height: `${Math.max(10, height * Math.max(0.25, cpuRatio))}%` }} />
              ))}
            </div>
          </div>
          <div className="metric-tile glass-panel">
            <div className="metric-icon memory-icon"><MemoryStick size={19}/></div>
            <div className="metric-copy"><span>{t('memory')}</span><strong>{Math.round(memoryRatio * 100)}<small>%</small></strong>
              <em>{formatSize(stats.memoryUsed)} / {formatSize(stats.memoryTotal)}</em></div>
            <div className="tiny-meter"><span style={{ width: `${memoryRatio * 100}%` }} /></div>
          </div>
          <div className="metric-tile glass-panel">
            <div className="metric-icon state-icon"><ShieldCheck size={19}/></div>
            <div className="metric-copy"><span>{t('systemState')}</span><strong className="status-title">{running ? t('running') : t('ready')}</strong>
              <em>{running ? taskName(activeTask || '') : stats.osName}</em></div>
          </div>
        </section>

        <section className="operations-head" id="maintenance">
          <div><div className="overline">{t('maintenance')}</div><h2>{t('operations')}</h2>
            <p>{t('operationsDescription')}</p></div>
          <div className="search-box"><Search size={17}/><input placeholder={t('search')} value={filter}
            onChange={event => setFilter(event.target.value)} aria-label={t('search')} /></div>
        </section>

        <div className="selection-bar">
          <StatPill icon={<CheckCircle2 size={15}/>} text={t('selectedCount', { n: selected.size })} />
          <div className="selection-actions">
            <button onClick={() => setSelected(new Set(['dism-check', 'dism-scan', 'sfc', 'chkdsk-scan', 'winget-list']))}
              disabled={running}><ShieldCheck size={14}/>{t('selectAllSafe')}</button>
            <button onClick={() => setSelected(new Set())} disabled={running}><X size={14}/>{t('clear')}</button>
          </div>
        </div>

        {CATEGORIES.map(category => {
          const matching = TASKS.filter(task => task.group === category && showTask(task));
          if (category === 'tools' && !matching.length && filter) return null;
          if (!matching.length && filter) return null;
          const Icon = categoryIcon[category];
          return (
            <section className="task-section" id={category} key={category}>
              <div className="section-title"><div className="group-icon"><Icon size={18}/></div>
                <h3>{t(sectionName[category])}</h3><span className="group-count">{matching.length}</span></div>
              {matching.length > 0 && <div className="task-grid">
                {matching.map(task => {
                  const IconForTask = icons[task.icon] || Activity;
                  const [title, description] = translateTask(lang, task.id);
                  const passed = outcomes[task.id];
                  return <label key={task.id} className={[
                    'task-card', 'glass-panel', selected.has(task.id) ? 'selected' : '',
                    activeTask === task.id && running ? 'executing' : '',
                    passed === true ? 'passed' : '', passed === false ? 'failed' : ''
                  ].join(' ')}>
                    <input type="checkbox" checked={selected.has(task.id)} disabled={running}
                      onChange={() => toggleTask(task.id)} aria-label={title}/>
                    <div className="task-icon"><IconForTask size={18}/></div>
                    <div className="task-info">
                      <div className="task-title-row"><strong>{title}</strong>
                        <span className={`task-check ${selected.has(task.id) ? 'checked' : ''}`}><Check size={11}/></span></div>
                      <p>{description}</p>
                      <div className="task-bottom"><code>{task.command}</code>
                        {task.warning && <span className="risk-indicator"><AlertTriangle size={12}/>{t('sensitive')}</span>}
                        {task.recommended && <span className="recommend-badge">{t('recommended')}</span>}
                        {passed === true && <span className="success-mark"><Check size={12}/>{t('done')}</span>}
                        {passed === false && <span className="error-mark"><X size={12}/>{t('failed')}</span>}
                      </div>
                    </div>
                  </label>;
                })}
              </div>}
              {category === 'disk' && (
                <div className="subpanel glass-panel drive-config">
                  <div><div className="subpanel-title"><HardDrive size={17}/>{t('drives')}</div>
                    <p>{t('driveDescription')}</p></div>
                  <div className="drive-select-box">
                    <select value={diskTarget} onChange={event => setDiskTarget(event.target.value)}
                      disabled={running || drives.length === 0} aria-label={t('drives')}>
                      <option value="all">{t('allDisks')}</option>
                      {drives.map(drive => <option value={drive.letter} key={drive.letter}>
                        {drive.letter} {drive.label ? '· ' + drive.label : ''} · {formatSize(drive.size)}
                      </option>)}
                    </select>
                    <button className="icon-button" onClick={updateDrives} title={t('refreshDrives')} disabled={running}><RefreshCcw size={17}/></button>
                  </div>
                  <div className="disk-warning"><AlertTriangle size={15}/>{t('repairNote')}</div>
                  {drives.length === 0 && <p className="alert-text">{t('diskMissing')}</p>}
                </div>
              )}
              {category === 'cleanup' && (
                <>
                  <div className="info-hint"><ShieldCheck size={15}/>{t('cleanupGuard')}</div>
                  <div className="info-hint"><CircleHelp size={15}/>{t('nativeWindow')}</div>
                </>
              )}
              {category === 'updates' && (
                <div className="subpanel glass-panel driver-panel">
                  <div className="driver-head"><span className="driver-icon"><Download size={18}/></span>
                    <div><strong>{t('drivers')}</strong><p>{t('driversText')}</p></div></div>
                  <div className="driver-buttons"><button onClick={() => openSettings('drivers')}><ExternalLink size={14}/>{t('openDriverSettings')}</button>
                    <button onClick={() => openSettings('updates')}>{t('openWindowsUpdate')}<ArrowRight size={15}/></button></div>
                </div>
              )}
              {category === 'tools' && (
                <div className="tool-grid">
                  {(['rammap', 'lasso'] as const).map(tool => {
                    const configuredPath = tool === 'rammap' ? bootstrap?.preferences.rammapPath : bootstrap?.preferences.lassoPath;
                    return <div className="subpanel glass-panel tool-card" key={tool}>
                      <div className="tool-mark">{tool === 'rammap' ? <MemoryStick size={20}/> : <Gauge size={20}/>}</div>
                      <div className="tool-title">{t(tool)}</div>
                      <span className={`tool-status ${configuredPath ? 'configured' : ''}`}>
                        <span className="dot"/>{configuredPath ? configuredPath.split(/[\\/]/).pop() : t('notConfigured')}</span>
                      <div className="tool-buttons">
                        <button disabled={running} onClick={() => chooseTool(tool)}><Search size={14}/>{t('selectExe')}</button>
                        <button disabled={!configuredPath} onClick={() => openTool(tool)}><ExternalLink size={14}/>{t('openTool')}</button>
                      </div>
                    </div>;
                  })}
                  <div className="info-hint tools-notice"><CircleHelp size={15}/>{t('externalNote')}</div>
                </div>
              )}
            </section>
          );
        })}

        <div className="bottom-note glass-panel"><LockKeyhole size={18}/><div><strong>{t('safeMode')}</strong><p>{t('safeText')}</p></div></div>
        <footer className="project-footer">
          <span>© {new Date().getFullYear()} <a href="https://github.com/RaphaelTW" target="_blank" rel="noreferrer">RaphaelTW</a> · MIT</span>
          <button onClick={() => void navigator.clipboard.writeText('c15b0dc5-808e-4b1b-aa90-6ff25ae1c0d9').then(() => setNotice('Chave PIX copiada.')).catch(() => setNotice('Não foi possível copiar a chave PIX.'))}>Apoie via PIX</button>
        </footer>
      </main>

      <aside className="inspector" id="execution">
        <div className="inspector-top"><span className="overline">{t('activity')}</span><span className="live-indicator"><span/>LIVE</span></div>
        <div className="inspector-hero glass-panel">
          <span className="inspector-eyebrow">{t('health')}</span>
          <div className="inspector-score"><span className="score-icon"><Activity size={23}/></span>
            <div><strong>{Math.round(cpuRatio * 100)}<small>%</small></strong><p>{t('cpu')} · {t('used')}</p></div></div>
          <div className="stat-separator"/>
          <div className="small-stat-row"><span>{t('memory')}</span><b>{formatSize(stats.memoryUsed)}</b></div>
          <div className="small-progress"><div style={{ width: `${memoryRatio * 100}%` }}/></div>
          <div className="small-stat-row"><span>{t('operation')}</span><b>{Math.round(queueRatio * 100)}%</b></div>
          <div className="small-progress second"><div style={{ width: `${queueRatio * 100}%` }}/></div>
        </div>
        <div className="execution-panel glass-panel">
          <div className="panel-heading"><strong>{t('execution')}</strong>
            <span className={`run-badge ${running ? 'active' : ''}`}><span/>{t(running ? 'running' : 'waiting')}</span></div>
          <div className="now-task"><span className="now-orb">{running ? <RefreshCcw size={21}/> : <CheckCircle2 size={21}/>}</span>
            <div><strong>{activeTask ? taskName(activeTask) : t('nothingRunning')}</strong>
              <p>{running ? t('stepOf', { a: step.current, b: step.total }) : t('readyDescription')}</p></div></div>
          <div className="overall-label"><span>{t('overall')}</span><b>{Math.round(queueRatio * 100)}%</b></div>
          <div className="execution-track"><div style={{ width: `${queueRatio * 100}%` }}/></div>
          <div className="step-progress">
            <span>{t('taskProgress')}</span><b>{progress == null ? '—' : progress + '%'}</b>
          </div>
          <div className={`step-track ${running && progress == null ? 'indeterminate' : ''}`}>
            <span style={{ width: progress == null ? '35%' : progress + '%' }}/></div>
          {running && progress == null && <div className="indeterminate-note">{t('indeterminate')}</div>}
          <button className="button button-outline stop-button" disabled={!running} onClick={async () => {
            try { if (await bridge.stop()) setNotice(t('stopQueued')); }
            catch (error) { setNotice(t('error', { message: String(error) })); }
          }}><Square size={13}/>{t('stop')}</button>
          {results && <div className="result-line">{t('failedSummary', { ok: results.completed, fail: results.failed, skip: results.skipped })}</div>}
        </div>
        <div className="log-panel glass-panel">
          <div className="panel-heading"><strong>{t('logTitle')}</strong>
            <button className="link-button" onClick={async () => {
              try { if (await bridge.exportLog()) setNotice(t('saved')); }
              catch (error) { setNotice(t('error', { message: String(error) })); }
            }}><FileText size={13}/>{t('export')}</button></div>
          <div className="log-scroll" role="log" aria-live="off">
            {!logs.length && <div className="log-empty"><Activity size={20}/>{t('noLog')}</div>}
            {logs.map(entry => <div className="log-row" key={entry.id}><span className="log-bullet"/> <span>{entry.content}</span></div>)}
            <div ref={logEnd}/>
          </div>
        </div>
        <div className="inspector-note"><ShieldCheck size={14}/>{t('localLog')}</div>
      </aside>

      {showConfirm && <div className="modal-backdrop" role="presentation" onMouseDown={event => {
        if (event.currentTarget === event.target) setShowConfirm(false);
      }}>
        <div className="confirm-dialog glass-panel" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <button className="dialog-close" aria-label={t('cancel')} onClick={() => setShowConfirm(false)}><X size={19}/></button>
          <div className="confirm-icon"><AlertTriangle size={23}/></div>
          <div className="overline">{t('riskTitle')}</div>
          <h2 id="confirm-title">{t('confirmTitle')}</h2>
          <p>{t('confirmText', { n: taskIds.length })}</p>
          {taskIds.some(id => id.startsWith('chkdsk-')) &&
            <div className="target-summary"><HardDrive size={16}/><span>{t('drives')}:</span>
              <strong>{diskTarget === 'all' ? t('allDisks') : diskTarget}</strong></div>}
          {warnings.length > 0 && <div className="warning-list">
            {warnings.map(warn => <div key={warn}><AlertTriangle size={16}/><span>{translations[lang].warning[warn]}</span></div>)}
          </div>}
          {selected.has('chkdsk-f') && <label className="repair-agreement"><input type="checkbox"
            checked={repairConfirmed} onChange={event => setRepairConfirmed(event.target.checked)}/>
            <span>{t('repairConfirm')}</span></label>}
          <div className="modal-actions"><button className="button button-outline" onClick={() => setShowConfirm(false)}>{t('cancel')}</button>
            <button className="button button-primary" onClick={begin}
              disabled={selected.has('chkdsk-f') && !repairConfirmed}><Play size={14} fill="currentColor"/>{t('confirmRun')}</button></div>
        </div>
      </div>}

      {showSettings && <div className="modal-backdrop" role="presentation" onMouseDown={event => {
        if (event.currentTarget === event.target) setShowSettings(false);
      }}>
        <section className="settings-dialog glass-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <button className="dialog-close" aria-label={t('cancel')} onClick={() => setShowSettings(false)}><X size={19}/></button>
          <div className="overline">{t('preferences')}</div>
          <h2 id="settings-title">{t('selectTheme')}</h2>
          <div className="theme-grid settings-theme-grid">
            {THEMES.map(item => (
              <button key={item.id} className={`theme-option ${theme === item.id ? 'selected' : ''}`}
                aria-pressed={theme === item.id} onClick={() => setTheme(item.id)}>
                <span className="theme-swatch" style={{ '--swatch-a': item.colors[0], '--swatch-b': item.colors[1] } as CSSProperties} />
                <span>{t(item.label)}</span>
              </button>
            ))}
          </div>
          <label className="settings-language"><span>{t('language')}</span><select value={lang} onChange={event => setLang(event.target.value as Language)}>
            <option value="pt">{t('langPt')}</option><option value="en">{t('langEn')}</option><option value="es">{t('langEs')}</option><option value="ru">{t('langRu')}</option><option value="zh">{t('langZh')}</option>
          </select></label>
        </section>
      </div>}
      {notice && <div className="toast" role="status"><AlertTriangle size={17}/>{notice}
        <button onClick={() => setNotice('')} aria-label="Fechar"><X size={14}/></button></div>}
    </div>
  );
}
