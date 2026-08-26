"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, ArrowRight, ArrowRightLeft, BarChart3, Beaker, Bot, BrainCircuit, CalendarClock, CalendarDays, Check, ChevronDown, CircleHelp, Database,
  Download, FileCheck2, FlaskConical, LayoutDashboard, List, LoaderCircle, Map as MapIcon, MessageSquareText, Search, Send,
  MapPinned, ReceiptText, ShieldCheck, Settings, Sparkles, Table2, TrendingDown, TrendingUp, UserRound, Users, WandSparkles,
} from "lucide-react";
import usa from "@svg-maps/usa";
import { LineChart } from "@/components/charts";
import type { AnalysisResult, AnalysisRun, ResultValue } from "@/lib/agent-types";
import type { BrandKey, BrandWindow, DashboardData, PairSummary, Period } from "@/lib/dashboard";
import { buildTrendForecast, nextWeeklyLabels } from "@/lib/forecast";

type View = "overview" | "switchers" | "study" | "analysis";

const COLORS: Record<BrandKey, string> = {
  celsius: "#4d46b8", alani_nu: "#8b5fd3", monster: "#315fc2",
  red_bull: "#6578db", ghost: "#684fbd", c4: "#3f86c8",
};

const SUGGESTIONS = [
  "Where is the destination brand gaining slowest?",
  "Where is the destination brand gaining fastest?",
  "Is switching promotion-led or durable?",
  "Which audience should we interview first?",
  "Explain the market trend beyond these brands",
  "Forecast the next eight weeks for both brands",
  "Which observed features have the highest WoE and IV?",
];

export default function TrendsDashboard({ data, mode = "dashboard" }: { data: DashboardData; mode?: "home" | "dashboard" }) {
  const router = useRouter();
  const [view, setView] = useState<View>("overview");
  const [from, setFrom] = useState<BrandKey>("celsius");
  const [to, setTo] = useState<BrandKey>("alani_nu");
  const [period, setPeriod] = useState<Period>(12);
  const [openMenu, setOpenMenu] = useState<"from" | "to" | "period" | null>(null);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<AnalysisRun | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [exportDone, setExportDone] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => { window.scrollTo(0, 0); }, [mode, view]);

  const pair = data.pairs[`${period}:${from}:${to}`];
  const source = data.brands[`${period}:${from}`];
  const destination = data.brands[`${period}:${to}`];
  const labels = Object.fromEntries(data.industry.brands.map((brand) => [brand.brand, brand.label])) as Record<BrandKey, string>;
  const fromLabel = labels[from];
  const toLabel = labels[to];

  function chooseFrom(value: BrandKey) {
    setFrom(value);
    if (value === to) setTo(from === value ? "alani_nu" : from);
    setAnswer(null);
    setAgentError(null);
    setIsAnalyzing(false);
  }
  function chooseTo(value: BrandKey) {
    setTo(value);
    if (value === from) setFrom(to === value ? "celsius" : to);
    setAnswer(null);
    setAgentError(null);
    setIsAnalyzing(false);
  }
  async function askAgent(prompt = query) {
    const submitted = prompt.trim();
    if (!submitted || isAnalyzing) return;
    setQuery(submitted);
    setIsAnalyzing(true);
    setAnswer(null);
    setAgentError(null);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: submitted, from, to, period }),
      });
      const payload = await response.json() as AnalysisRun | { error?: string };
      if (!response.ok || !("runId" in payload)) throw new Error("error" in payload ? payload.error : "The analysis could not be completed.");
      setAnswer(payload);
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "The analysis could not be completed.");
    } finally {
      setIsAnalyzing(false);
    }
  }
  function exportCurrentView() {
    const rows: (string | number)[][] = [
      ["Trends export", `${fromLabel} vs ${toLabel}`],
      ["View", title],
      ["Window", `${data.industry.weeks.at(-period)} to ${data.meta.panel.end} (${period} weeks)`],
      [],
      ["Section", "Metric", "Value", "Definition"],
      ["Brand", `${fromLabel} observed buyer share`, source.observedShare, data.definitions.observedShare],
      ["Brand", `${toLabel} observed buyer share`, destination.observedShare, data.definitions.observedShare],
      ["Brand", `${fromLabel} share change (points)`, source.deltaPts ?? "not available", data.definitions.shareChange],
      ["Brand", `${toLabel} share change (points)`, destination.deltaPts ?? "not available", data.definitions.shareChange],
      ["Switching", `${fromLabel} to ${toLabel}`, pair.switchers, data.definitions.switchers],
      ["Switching", `${toLabel} to ${fromLabel}`, pair.reverse, data.definitions.switchers],
      ["Switching", "Net flow", pair.net, data.definitions.netFlow],
      ["Switching", "Reachable now", pair.reachable, data.definitions.reachable],
      ["Switching", "Destination repeaters", pair.repeaters, data.definitions.repeat],
      ...Object.entries(pair.regions).map(([region, count]) => ["Region", titleCase(region), count, "Qualified switcher count"]),
      ...Object.entries(pair.channels).map(([channel, count]) => ["Channel", titleCase(channel), count, "Qualified switcher count"]),
    ];
    if (view === "switchers") {
      rows.push([], ["Buyer ID", "Region", "Tier", "Occasion", "Channel", `${fromLabel} purchases`, `${toLabel} purchases`, "Badge consent"]);
      pair.people.forEach((person) => rows.push([person.id, person.region, person.tier, person.occasion, person.channel, person.sourcePurchases, person.destinationPurchases, person.consent ? "yes" : "no"]));
    }
    if (view === "analysis" && answer) {
      rows.push([], ["Agent question", answer.question], ["Agent finding", answer.answer.title], ["Agent answer", answer.answer.summary]);
      answer.results.forEach((result) => rows.push(["Operation", result.title, `${result.rows.length} result rows`, result.calculation], ["Caveat", result.title, result.sampleSize, result.caveat]));
    }
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `trends-${from}-vs-${to}-${view}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setExportDone(true);
    window.setTimeout(() => setExportDone(false), 1800);
  }

  const title = view === "overview" ? "Brand comparison" : view === "switchers" ? "Verified switchers" : view === "study" ? "Study builder" : "Data science agent";

  if (mode === "home") return <OpeningPage data={data} onEnter={() => router.push("/dashboard")} />;

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <button className="wordmark" onClick={() => router.push("/")} title="Return to the Trends home"><strong>Trends</strong><small>Research intelligence</small></button>
        <nav aria-label="Workspace">
          <NavButton active={view === "overview"} icon={<LayoutDashboard size={17} />} label="Overview" onClick={() => setView("overview")} />
          <NavButton active={view === "switchers"} icon={<Users size={17} />} label="Switchers" count={pair.reachable} onClick={() => setView("switchers")} />
          <NavButton active={view === "study"} icon={<FlaskConical size={17} />} label="Study" onClick={() => setView("study")} />
          <NavButton active={view === "analysis"} icon={<Bot size={17} />} label="Ask Trends" onClick={() => setView("analysis")} />
        </nav>
        <div className="side-foot">
          <i>AP</i><span>Anushka</span><strong>Researcher</strong>
          <button aria-label="Profile and settings" aria-expanded={profileOpen} onClick={() => setProfileOpen(!profileOpen)}><Settings size={15} /></button>
          {profileOpen && <div className="profile-popover" role="menu"><button role="menuitem"><UserRound size={14} /> Profile</button><button role="menuitem"><Settings size={14} /> Preferences</button></div>}
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div><p>Energy drinks / United States</p><h1>{title}</h1></div>
          <div className="topbar-actions">
            <span className="panel-status"><Database size={13} /> 25,000 buyers <i /> {period} week window</span>
            <button className={exportDone ? "export-button exported" : "export-button"} title="Download current analysis as CSV" onClick={exportCurrentView}>{exportDone ? <Check size={15} /> : <Download size={15} />} {exportDone ? "Downloaded" : "Export"}</button>
          </div>
        </header>

        <section className="comparison-bar" aria-label="Brand comparison controls">
          <SelectMenu id="from" label="Baseline brand" value={from} valueLabel={fromLabel} color={COLORS[from]} open={openMenu === "from"} onToggle={() => setOpenMenu(openMenu === "from" ? null : "from")} onChange={(value) => { chooseFrom(value as BrandKey); setOpenMenu(null); }} options={data.industry.brands.filter((brand) => brand.brand !== "other").map((brand) => ({ value: brand.brand, label: brand.label, color: COLORS[brand.brand as BrandKey] }))} />
          <ArrowRightLeft className="swap-icon" size={17} />
          <SelectMenu id="to" label="Comparison brand" value={to} valueLabel={toLabel} color={COLORS[to]} open={openMenu === "to"} onToggle={() => setOpenMenu(openMenu === "to" ? null : "to")} onChange={(value) => { chooseTo(value as BrandKey); setOpenMenu(null); }} options={data.industry.brands.filter((brand) => brand.brand !== "other").map((brand) => ({ value: brand.brand, label: brand.label, color: COLORS[brand.brand as BrandKey] }))} />
          <SelectMenu id="period" label="Time period" value={String(period)} valueLabel={period === 52 ? "Full 52 weeks" : `Latest ${period} weeks`} icon={<CalendarDays size={14} />} open={openMenu === "period"} onToggle={() => setOpenMenu(openMenu === "period" ? null : "period")} onChange={(value) => { setPeriod(Number(value) as Period); setAnswer(null); setAgentError(null); setOpenMenu(null); }} options={data.periods.map((value) => ({ value: String(value), label: value === 52 ? "Full 52 weeks" : `Latest ${value} weeks` }))} />
        </section>

        {view === "overview" && <Overview data={data} period={period} pair={pair} source={source} destination={destination} fromLabel={fromLabel} toLabel={toLabel} onSwitchers={() => setView("switchers")} onAsk={(prompt) => { setView("analysis"); askAgent(prompt); }} />}
        {view === "switchers" && <Switchers pair={pair} period={period} fromLabel={fromLabel} toLabel={toLabel} onStudy={() => setView("study")} />}
        {view === "study" && <Study pair={pair} period={period} fromLabel={fromLabel} toLabel={toLabel} launched={launched} setLaunched={setLaunched} />}
        {view === "analysis" && <Agent pair={pair} source={source} destination={destination} fromLabel={fromLabel} toLabel={toLabel} query={query} setQuery={setQuery} answer={answer} isAnalyzing={isAnalyzing} error={agentError} ask={askAgent} />}
      </main>
    </div>
  );
}

function OpeningPage({ data, onEnter }: { data: DashboardData; onEnter: () => void }) {
  const brands = data.industry.brands.filter((brand) => brand.brand !== "other").slice(0, 4);
  const examplePair = data.pairs["12:celsius:alani_nu"];
  return <div className="opening-page">
    <header className="opening-header"><strong>Trends</strong><span>Consumer research intelligence</span></header>
    <main className="opening-hero">
      <div className="opening-copy">
        <p className="eyebrow">Household intelligence / Energy drinks</p>
        <h1>Trends</h1>
        <h2>Tomorrow&apos;s market is already visible in customers&apos; homes.</h2>
        <p>Find the behavioral shift before it becomes a headline, then speak with the verified buyers already creating it.</p>
        <button className="opening-cta" onClick={onEnter}>Enter the live analysis <ArrowRight size={16} /></button>
      </div>

      <section className="opening-visual" aria-label="Energy drink study preview">
        <div className="opening-visual-head"><span>Signal 014 / United States / 12 weeks</span><b><i /> Live evidence</b></div>
        <div className="opening-finding">
          <span>Household behavior is leading the market</span>
          <h3>Flavor-led energy is changing who earns the repeat purchase.</h3>
          <p>{examplePair.switchers} verified Celsius buyers moved toward Alani Nu. {examplePair.reachable} can be contacted to explain why.</p>
        </div>
        <div className="opening-progression"><header><span>Observed progression</span><small>From household behavior to durable market evidence</small></header><div className="opening-signal-path"><div><span>01</span><section><small>Household signal</small><strong>Flavor trial accelerates</strong><em>Early pattern</em></section></div><div><span>02</span><section><small>Verified brand movement</small><strong>{examplePair.switchers} buyers switch</strong><em>Celsius to Alani Nu</em></section></div><div><span>03</span><section><small>Durability evidence</small><strong>{examplePair.repeaters} buyers repeat</strong><em>Observed 2+ purchases</em></section></div></div></div>
        <div className="opening-flow"><div><span>Celsius</span><strong>{examplePair.sourceBase.toLocaleString()}</strong><small>baseline buyers</small></div><i><b>{examplePair.switchers}</b><small>switched</small></i><div><span>Alani Nu</span><strong>{examplePair.repeaters}</strong><small>repeat buyers</small></div></div>
        <div className="opening-brand-list">{brands.map((brand) => <div key={brand.brand}><span>{brand.label}</span><i><b style={{ width: `${Math.min(100, brand.observed_share * 280)}%`, background: COLORS[brand.brand as BrandKey] }} /></i><strong>{pct(brand.observed_share)}</strong></div>)}</div>
      </section>
    </main>
    <footer className="opening-meta"><div><span>Panel</span><strong>{data.meta.panel.buyers.toLocaleString()} buyers</strong></div><div><span>Evidence</span><strong>{data.meta.panel.events.toLocaleString()} transactions</strong></div><div><span>Coverage</span><strong>50 states / {data.meta.panel.weeks} weeks</strong></div><div><span>Workflow</span><strong>Signal to interview</strong></div></footer>
  </div>;
}

function NavButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  return <button aria-label={count === undefined ? label : `${label}, ${count} reachable`} className={active ? "nav-button active" : "nav-button"} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <b>{count}</b>}</button>;
}

function SelectMenu({ id, label, value, valueLabel, color, icon, options, open, onToggle, onChange }: { id: string; label: string; value: string; valueLabel: string; color?: string; icon?: React.ReactNode; options: { value: string; label: string; color?: string }[]; open: boolean; onToggle: () => void; onChange: (value: string) => void }) {
  return <div className="select-menu">
    <button id={`${id}-button`} type="button" className={open ? "select-trigger open" : "select-trigger"} aria-haspopup="listbox" aria-expanded={open} onClick={onToggle}>
      <span className="select-label">{label}</span><i className="select-swatch" style={color ? { background: color } : undefined}>{!color && icon}</i><strong>{valueLabel}</strong><ChevronDown size={14} />
    </button>
    {open && <div className="select-options" role="listbox" aria-labelledby={`${id}-button`}>{options.map((option) => <button type="button" role="option" aria-selected={value === option.value} className={value === option.value ? "selected" : ""} key={option.value} onClick={() => onChange(option.value)}>{option.color && <i style={{ background: option.color }} />}{!option.color && <CalendarDays size={13} />}<span>{option.label}</span>{value === option.value && <Check size={14} />}</button>)}</div>}
  </div>;
}

function InfoTip({ text }: { text: string }) {
  return <span className="info-tip" tabIndex={0} aria-label={`Calculation: ${text}`}><CircleHelp size={14} /><span role="tooltip"><strong>How it is calculated</strong>{text}</span></span>;
}

function Metric({ label, value, change, definition, tone }: { label: string; value: string; change?: string; definition: string; tone?: "up" | "down" | "neutral" }) {
  return <article className="metric"><div className="metric-label"><span>{label}</span><InfoTip text={definition} /></div><strong>{value}</strong>{change && <small className={tone ?? "neutral"}>{tone === "up" ? <TrendingUp size={12} /> : tone === "down" ? <TrendingDown size={12} /> : null}{change}</small>}</article>;
}

function Overview({ data, period, pair, source, destination, fromLabel, toLabel, onSwitchers, onAsk }: { data: DashboardData; period: Period; pair: PairSummary; source: BrandWindow; destination: BrandWindow; fromLabel: string; toLabel: string; onSwitchers: () => void; onAsk: (prompt: string) => void }) {
  const topRegion = topEntry(pair.regions);
  const topChannel = topEntry(pair.channels);
  const delta = destination.deltaPts;
  const weeks = data.industry.weeks.slice(-period);
  return <div className="view-stack">
    <section className="metrics-grid">
      <Metric label={`${toLabel} buyer share`} value={pct(destination.observedShare)} change={delta === null ? "Full panel window" : `${signed(delta)} pts vs prior`} tone={delta === null ? "neutral" : delta >= 0 ? "up" : "down"} definition={data.definitions.observedShare} />
      <Metric label={`${toLabel} purchase frequency`} value={`${destination.frequency.toFixed(2)}x`} change={`${destination.events.toLocaleString()} verified events`} definition={data.definitions.frequency} />
      <Metric label={`${fromLabel} to ${toLabel}`} value={pair.switchers.toLocaleString()} change={`${pct(pair.switchRate)} of active baseline buyers`} tone={pair.net >= 0 ? "up" : "down"} definition={data.definitions.switchers} />
      <Metric label="Net brand flow" value={signed(pair.net)} change={`${pair.reverse} moved in reverse`} tone={pair.net >= 0 ? "up" : "down"} definition={data.definitions.netFlow} />
    </section>

    <section className="analysis-grid">
      <article className="panel chart-panel">
        <div className="panel-head"><div><span className="eyebrow">Observed buyer share</span><h2>How the brands are moving</h2></div><InfoTip text="Weekly distinct brand buyers / weekly distinct category buyers. A buyer may purchase both brands in one week." /></div>
        <div className="chart-legend"><span><i style={{ background: COLORS[source.brand as BrandKey] }} />{fromLabel}</span><span><i style={{ background: COLORS[destination.brand as BrandKey] }} />{toLabel}</span></div>
        <LineChart labels={weeks} series={[{ values: source.weeklyShare.slice(-period).map((v) => v * 100), color: COLORS[source.brand], width: 2, label: fromLabel }, { values: destination.weeklyShare.slice(-period).map((v) => v * 100), color: COLORS[destination.brand], width: 2.5, label: toLabel }]} yFmt={(value) => `${value.toFixed(0)}%`} tooltipFmt={(value) => `${value.toFixed(2)}%`} height={260} />
        <div className="chart-note"><Sparkles size={15} /><span><strong>{delta === null ? `${toLabel} across the full 52-week panel` : `${toLabel} changed ${signed(delta)} points`}</strong>{delta === null ? " No matched prior 52-week window is available." : ` versus the previous ${period}-week window.`}</span><button onClick={() => onAsk("Explain what is driving the comparison brand trend")}>Analyze <WandSparkles size={13} /></button></div>
      </article>

      <article className="panel flow-panel">
        <div className="panel-head"><div><span className="eyebrow">Behavioral flow</span><h2>Where buyers moved</h2></div><InfoTip text={data.definitions.switchers} /></div>
        <div className="flow-route"><div className="flow-brand"><i style={{ background: COLORS[source.brand] }}>{fromLabel.slice(0, 1)}</i><span><strong>{fromLabel}</strong><small>{pair.sourceBase.toLocaleString()} baseline buyers</small></span></div><div className="flow-transfer"><span>Qualified movement</span><strong>{pair.switchers}</strong><i><b style={{ width: `${Math.min(100, pair.switchRate * 1000)}%` }} /></i><small>{pct(pair.switchRate)} of active baseline buyers</small></div><div className="flow-brand destination"><i style={{ background: COLORS[destination.brand] }}>{toLabel.slice(0, 1)}</i><span><strong>{toLabel}</strong><small>{pair.repeaters} reached repeat</small></span></div></div>
        <div className="flow-outcomes"><div><span>Repeat durability</span><strong>{pct(pair.repeaters / Math.max(pair.switchers, 1))}</strong><small>{pair.repeaters} bought {toLabel} at least twice</small></div><div><span>Reverse movement</span><strong>{pair.reverse}</strong><small>{toLabel} buyers moved toward {fromLabel}</small></div><div><span>Net outcome</span><strong className={pair.net >= 0 ? "positive" : "negative"}>{signed(pair.net)}</strong><small>buyers toward {toLabel}</small></div></div>
        <div className="flow-context"><span><b>Where</b>{titleCase(topRegion[0])} / {topRegion[1]} switchers</span><span><b>Channel</b>{titleCase(topChannel[0])} / {topChannel[1]} switchers</span></div>
        <button className="panel-action" onClick={onSwitchers}><Users size={15} /> See {pair.reachable} reachable switchers <span>View now</span></button>
      </article>
    </section>

    <TrendOutlook destination={destination} fromLabel={fromLabel} toLabel={toLabel} weeks={data.industry.weeks} onAsk={onAsk} />

    <StateLeanChart pair={pair} source={source} destination={destination} fromLabel={fromLabel} toLabel={toLabel} definition={data.definitions.stateLean} />

    <section className="panel shifts-panel">
      <div className="panel-head"><div><span className="eyebrow">Across the category</span><h2>Shifts worth investigating</h2></div><button className="text-button" onClick={() => onAsk("Explain the market trend beyond these brands")}>Full category analysis <ArrowRightLeft size={13} /></button></div>
      <div className="shift-table">{data.signals.filter((signal) => ["qualified", "emerging"].includes(signal.state)).slice(0, 5).map((signal) => <button key={signal.id} onClick={() => onAsk(`Analyze this shift: ${signal.title}`)}><span className={`status-dot ${signal.state}`} /><div><strong>{signal.title}</strong><small>{signal.kind} / {signal.level}</small></div><b>{signal.buyers.toLocaleString()}</b><span>buyers</span><ChevronDown size={14} /></button>)}</div>
    </section>
  </div>;
}

function TrendOutlook({ destination, fromLabel, toLabel, weeks, onAsk }: { destination: BrandWindow; fromLabel: string; toLabel: string; weeks: string[]; onAsk: (prompt: string) => void }) {
  const outlook = buildTrendForecast(destination.weeklyShare, 8);
  const observed = destination.weeklyShare.slice(-12).map((value) => value * 100);
  const forecast = outlook.points.map((point) => point.value * 100);
  const labels = [...weeks.slice(-12), ...nextWeeklyLabels(weeks.at(-1)!, outlook.horizon)];
  const latest = destination.weeklyShare.at(-1)! * 100;
  const final = outlook.points.at(-1)!;
  return <section className="panel outlook-panel">
    <div className="outlook-head"><div><span className="eyebrow">Future trend outlook / model estimate</span><h2>{toLabel} buyer-share trajectory</h2><p>Eight-week damped trend selected against rolling holdout error. Forecast values are model outputs, never LLM-generated.</p></div><button className="secondary-button" onClick={() => onAsk(`Forecast the next eight weeks for ${fromLabel} and ${toLabel}`)}><WandSparkles size={13} /> Analyze forecast</button></div>
    <div className="outlook-layout"><div className="outlook-chart"><div className="chart-legend"><span><i style={{ background: COLORS[destination.brand] }} />Observed {toLabel}</span><span><i className="forecast-key" style={{ borderColor: COLORS[destination.brand] }} />Forecast path</span></div><LineChart labels={labels} series={[{ values: observed, color: COLORS[destination.brand], width: 2.5, label: "Observed" }, { values: [...Array(11).fill(null), observed.at(-1), ...forecast], color: COLORS[destination.brand], width: 1.8, dash: true, label: "Forecast" }]} band={{ from: 11, to: 19, label: "8-week forecast" }} yFmt={(value) => `${value.toFixed(0)}%`} tooltipFmt={(value) => `${value.toFixed(2)}%`} height={235} /></div>
      <aside className="outlook-readout"><div><span>Eight-week direction</span><strong className={outlook.direction}>{outlook.direction === "flat" ? "Stable" : outlook.direction === "up" ? "Rising" : "Softening"}</strong><small>{signed(outlook.delta * 100)} points from {latest.toFixed(2)}%</small></div><div><span>Final projection</span><strong>{pct(final.value)}</strong><small>90% interval {pct(final.lower)} to {pct(final.upper)}</small></div><div><span>Validation error</span><strong>{(outlook.validationMae * 100).toFixed(2)} pts</strong><small>Rolling one-step MAE / 16 holdouts</small></div><div><span>Bayesian tuning</span><strong>{outlook.trials} trials</strong><small>alpha {outlook.parameters.alpha.toFixed(2)} / beta {outlook.parameters.beta.toFixed(2)} / phi {outlook.parameters.phi.toFixed(2)}</small></div></aside>
    </div>
    <footer><ShieldCheck size={13} /><span><strong>Interpretation boundary</strong> This extends the observed panel trend. It is not a causal demand forecast and does not anticipate promotions, launches, distribution changes, or other shocks.</span></footer>
  </section>;
}

function StateLeanChart({ pair, source, destination, fromLabel, toLabel, definition }: { pair: PairSummary; source: BrandWindow; destination: BrandWindow; fromLabel: string; toLabel: string; definition: string }) {
  const [showAll, setShowAll] = useState(false);
  const [display, setDisplay] = useState<"map" | "list">("map");
  const states = [...pair.states].sort((a, b) => Math.abs(b.leanPoints) - Math.abs(a.leanPoints));
  const visible = showAll ? states : states.slice(0, 14);
  const max = Math.max(1, ...states.map((state) => Math.abs(state.leanPoints)));
  const fastest = [...pair.regionStats].sort((a, b) => b.rate - a.rate)[0];
  const slowest = [...pair.regionStats].filter((row) => row.sourceBase >= 50).sort((a, b) => a.rate - b.rate)[0];
  return <section className="panel geography-panel">
    <div className="panel-head"><div><span className="eyebrow">Geographic brand lean</span><h2>Where each state leans</h2></div><div className="geo-actions"><InfoTip text={definition} /><div className="geo-view-toggle" role="group" aria-label="Geography display"><button className={display === "map" ? "active" : ""} onClick={() => setDisplay("map")}><MapIcon size={13} /> Map</button><button className={display === "list" ? "active" : ""} onClick={() => setDisplay("list")}><List size={13} /> List</button></div>{display === "list" && <button className="text-button" onClick={() => setShowAll(!showAll)}>{showAll ? "Show top 14" : "Show all 50 states"}</button>}</div></div>
    <div className="region-rate-strip"><div><span>Fastest switching rate</span><strong>{titleCase(fastest?.region ?? "n/a")}</strong><small>{pct(fastest?.rate ?? 0)} / {fastest?.switchers ?? 0} of {fastest?.sourceBase ?? 0}</small></div><div><span>Slowest switching rate</span><strong>{titleCase(slowest?.region ?? "n/a")}</strong><small>{pct(slowest?.rate ?? 0)} / {slowest?.switchers ?? 0} of {slowest?.sourceBase ?? 0}</small></div><div><span>Window sample</span><strong>{destination.categoryBuyers.toLocaleString()}</strong><small>active / 25,000 buyer rows scanned</small></div></div>
    {display === "map" ? <StateLeanMap states={states} source={source} destination={destination} fromLabel={fromLabel} toLabel={toLabel} max={max} /> : <><div className="lean-axis"><span style={{ color: COLORS[source.brand] }}>{fromLabel} affinity</span><i /><span style={{ color: COLORS[destination.brand] }}>{toLabel} affinity</span></div>
    <div className="state-lean-grid">{visible.map((state) => {
      const width = `${Math.max(1.5, (Math.abs(state.leanPoints) / max) * 48)}%`;
      return <div className="state-lean-row" key={state.state}><strong>{state.state}</strong><span>{titleCase(state.region)}</span><div className="lean-track"><i className={state.leanPoints >= 0 ? "to" : "from"} style={state.leanPoints >= 0 ? { left: "50%", width } : { right: "50%", width }} /></div><b className={state.leanPoints >= 0 ? "to" : "from"}>{signed(state.leanPoints)} pts</b><small>{signed(state.netSwitchers)} net</small></div>;
    })}</div></>}
  </section>;
}

function StateLeanMap({ states, source, destination, fromLabel, toLabel, max }: { states: PairSummary["states"]; source: BrandWindow; destination: BrandWindow; fromLabel: string; toLabel: string; max: number }) {
  const [hovered, setHovered] = useState<PairSummary["states"][number] | null>(null);
  const byState = Object.fromEntries(states.map((state) => [state.state.toLowerCase(), state]));
  const destinationLeaders = states.filter((state) => state.leanPoints >= 0).sort((a, b) => b.leanPoints - a.leanPoints).slice(0, 4);
  const sourceLeaders = states.filter((state) => state.leanPoints < 0).sort((a, b) => a.leanPoints - b.leanPoints).slice(0, 4);
  return <div className="state-map-layout"><div className="state-map-wrap">
    <svg className="state-map" viewBox={usa.viewBox} role="img" aria-label={`United States map showing state affinity between ${fromLabel} and ${toLabel}`}>{usa.locations.map((location: { id: string; name: string; path: string }) => {
      const row = byState[location.id];
      const destinationLean = (row?.leanPoints ?? 0) >= 0;
      const intensity = .22 + (Math.abs(row?.leanPoints ?? 0) / Math.max(max, 1)) * .78;
      const leaningBrand = row && row.leanPoints >= 0 ? toLabel : fromLabel;
      return <path key={location.id} d={location.path} tabIndex={row ? 0 : -1} aria-label={`${location.name}: ${row ? `${Math.abs(row.leanPoints).toFixed(2)} points toward ${leaningBrand}` : "no data"}`} style={{ fill: row ? (destinationLean ? COLORS[destination.brand] : COLORS[source.brand]) : "#dfe0e4", fillOpacity: row ? intensity : 1 }} onMouseEnter={() => setHovered(row ?? null)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(row ?? null)} onBlur={() => setHovered(null)} />;
    })}</svg>
    <div className="map-legend"><header><span>Map legend</span><small>Relative state affinity index</small></header><div className="map-legend-scale" style={{ background: `linear-gradient(90deg, ${COLORS[source.brand]} 0%, #eef1f8 50%, ${COLORS[destination.brand]} 100%)` }} /><div className="map-legend-labels"><span style={{ color: COLORS[source.brand] }}><strong>{fromLabel}</strong><small>negative lean</small></span><span><strong>0</strong><small>neutral</small></span><span style={{ color: COLORS[destination.brand] }}><strong>{toLabel}</strong><small>positive lean</small></span></div><p>Darker fill means a larger absolute affinity difference. Hover a state for points, active buyers, and net switches.</p></div>
    {hovered && <div className="map-tooltip"><span>{hovered.state} / {titleCase(hovered.region)}</span><strong>{hovered.leanPoints >= 0 ? toLabel : fromLabel} +{Math.abs(hovered.leanPoints).toFixed(2)} pts</strong><small>{hovered.categoryBuyers.toLocaleString()} active buyers / {signed(hovered.netSwitchers)} net switches</small></div>}
  </div><aside className="map-rankings"><div><span className="eyebrow">Strongest {toLabel} affinity</span>{destinationLeaders.map((state, index) => <p key={state.state}><b>{String(index + 1).padStart(2, "0")}</b><strong>{state.state}</strong><span>{signed(state.leanPoints)} pts</span></p>)}</div><div><span className="eyebrow">Strongest {fromLabel} affinity</span>{sourceLeaders.map((state, index) => <p key={state.state}><b>{String(index + 1).padStart(2, "0")}</b><strong>{state.state}</strong><span>{Math.abs(state.leanPoints).toFixed(2)} pts</span></p>)}</div></aside></div>;
}

function Switchers({ pair, period, fromLabel, toLabel, onStudy }: { pair: PairSummary; period: Period; fromLabel: string; toLabel: string; onStudy: () => void }) {
  const [filter, setFilter] = useState("");
  const [profileTab, setProfileTab] = useState<"demographics" | "psychographics" | "behavior" | "people">("demographics");
  const people = pair.people.filter((person) => `${person.id} ${person.region} ${person.occasion} ${person.channel}`.includes(filter.toLowerCase()));
  const regions = pair.regionStats.map((region) => {
    const cohortShare = region.switchers / Math.max(pair.switchers, 1);
    const baselineShare = region.sourceBase / Math.max(pair.sourceBase, 1);
    return { ...region, cohortShare, baselineShare, index: baselineShare ? (cohortShare / baselineShare) * 100 : 0 };
  }).sort((a, b) => b.index - a.index);
  const stateHotspots = [...pair.states].sort((a, b) => b.sourceToDestination - a.sourceToDestination).slice(0, 6);
  const occasions = distributionRows(pair.occasions, pair.switchers);
  const channels = distributionRows(pair.channels, pair.switchers);
  const tiers = distributionRows(pair.tiers, pair.switchers);
  return <div className="view-stack">
    <section className="audience-studio">
      <header className="audience-head"><div><span className="eyebrow">Audience intelligence / verified behavior</span><h2>Understand the people behind the switch.</h2><p>Profile the cohort, compare it with the baseline audience, then recruit the exact buyers who can explain the movement.</p></div><button className="primary-button" onClick={onStudy}><FlaskConical size={15} /> Build a study</button></header>

      <div className="cohort-compare" aria-label="Audience cohort comparison"><div><span>Primary cohort</span><strong>{fromLabel} to {toLabel} switchers</strong><small>{pair.switchers.toLocaleString()} behavior-qualified buyers / latest {period} weeks</small></div><i><ArrowRightLeft size={16} /></i><div><span>Comparison cohort</span><strong>Baseline {fromLabel} buyers</strong><small>{pair.sourceBase.toLocaleString()} category-active buyers / same window</small></div></div>

      <nav className="audience-tabs" role="tablist" aria-label="Audience profile"><button role="tab" aria-selected={profileTab === "demographics"} className={profileTab === "demographics" ? "active" : ""} onClick={() => setProfileTab("demographics")}><MapPinned size={14} /> Demographics</button><button role="tab" aria-selected={profileTab === "psychographics"} className={profileTab === "psychographics" ? "active" : ""} onClick={() => setProfileTab("psychographics")}><BrainCircuit size={14} /> Psychographics</button><button role="tab" aria-selected={profileTab === "behavior"} className={profileTab === "behavior" ? "active" : ""} onClick={() => setProfileTab("behavior")}><ReceiptText size={14} /> Purchase behavior</button><button role="tab" aria-selected={profileTab === "people"} className={profileTab === "people" ? "active" : ""} onClick={() => setProfileTab("people")}><Users size={14} /> Recruitable people <b>{pair.reachable}</b></button></nav>

      {profileTab === "demographics" && <div className="audience-view demographics-view"><header className="profile-view-head"><div><span className="eyebrow">Observed demographic coverage</span><h3>Where switchers over-index</h3><p>Regional composition of the switcher cohort compared with active baseline {fromLabel} buyers.</p></div><div className="integrity-note"><ShieldCheck size={14} /><span><strong>No demographic guessing</strong>Age, income, and household data are not present, so Trends does not infer them.</span></div></header><div className="profile-grid"><section className="index-chart"><header><span>Region</span><span>Switcher share</span><span>Baseline share</span><span>Index</span></header>{regions.map((region) => <div className="index-row" key={region.region}><strong>{titleCase(region.region)}</strong><div className="dual-bars"><i style={{ width: `${region.cohortShare * 100}%` }} /><i style={{ width: `${region.baselineShare * 100}%` }} /></div><span>{pct(region.cohortShare)}<small>{pct(region.baselineShare)}</small></span><b className={region.index >= 110 ? "high" : region.index < 90 ? "low" : ""}>{Math.round(region.index)}</b></div>)}<footer><span><i /> Switcher cohort</span><span><i /> Baseline audience</span><small>100 = expected representation</small></footer></section><aside className="state-hotspots"><span className="eyebrow">Largest state cohorts</span><h4>Verified switch volume</h4>{stateHotspots.map((state, index) => <div key={state.state}><b>{String(index + 1).padStart(2, "0")}</b><strong>{state.state}</strong><span><i style={{ width: `${Math.max(5, state.sourceToDestination / Math.max(stateHotspots[0]?.sourceToDestination ?? 1, 1) * 100)}%` }} /></span><em>{state.sourceToDestination}</em></div>)}<p>Counts show observed switches, not population-adjusted market size.</p></aside></div></div>}

      {profileTab === "psychographics" && <div className="audience-view psychographics-view"><header className="profile-view-head"><div><span className="eyebrow">Behavior-grounded psychographics</span><h3>What the cohort&apos;s routines suggest</h3><p>Motivational hypotheses derived from purchase occasion, channel, promotion exposure, and repeat behavior.</p></div><div className="integrity-note blue"><BrainCircuit size={14} /><span><strong>Hypotheses, not labels</strong>These signals guide interview questions; they are not asserted personality traits.</span></div></header><div className="psycho-layout"><section className="occasion-profile"><div className="section-label"><span>Observed purchase occasion</span><small>Share of qualified switchers</small></div>{occasions.map((row) => <AudienceBar key={row.label} label={occasionLabel(row.label)} sublabel={titleCase(row.label)} value={row.share} count={row.count} />)}</section><aside className="mindset-readout"><span className="eyebrow">Research readout</span><h4>{occasionLabel(occasions[0]?.label ?? "daily")} is the largest observed context.</h4><p>The cohort is most often associated with <strong>{titleCase(occasions[0]?.label ?? "daily")}</strong> occasions. Use interviews to test whether {toLabel} is winning because it fits that moment better or because another trigger created initial trial.</p><div><span>Repeat signal<strong>{pct(pair.repeaters / Math.max(pair.switchers, 1))}</strong><small>{pair.repeaters} buyers purchased {toLabel} 2+ times</small></span><span>Promotion exposure<strong>{pct(pair.promoLed / Math.max(pair.switchers, 1))}</strong><small>{pair.promoLed} buyers had a promoted event</small></span></div><button onClick={onStudy}>Test these hypotheses <ArrowRight size={13} /></button></aside></div></div>}

      {profileTab === "behavior" && <div className="audience-view behavior-view"><header className="profile-view-head"><div><span className="eyebrow">Verified purchase behavior</span><h3>From baseline buyer to research-ready switcher</h3><p>Every stage is calculated from observed transactions in the same {period}-week window.</p></div><InfoTip text="Qualified switching uses baseline buyers as its denominator. Repeat and reachability are then reported within the qualified switcher cohort." /></header><div className="behavior-layout"><section className="cohort-funnel"><div><span>Active baseline buyers<small>Selected source cohort</small></span><strong>{pair.sourceBase.toLocaleString()}</strong><i style={{ "--fill": "100%" } as React.CSSProperties} /></div><div><span>Qualified switchers<small>{pct(pair.switchRate)} of baseline</small></span><strong>{pair.switchers.toLocaleString()}</strong><i style={{ "--fill": `${Math.max(10, pair.switchRate * 100)}%` } as React.CSSProperties} /></div><div><span>Destination repeaters<small>{pct(pair.repeaters / Math.max(pair.switchers, 1))} of switchers</small></span><strong>{pair.repeaters.toLocaleString()}</strong><i style={{ "--fill": `${pair.repeaters / Math.max(pair.switchers, 1) * 100}%` } as React.CSSProperties} /></div><div><span>Reachable now<small>{pct(pair.reachable / Math.max(pair.switchers, 1))} of switchers</small></span><strong>{pair.reachable.toLocaleString()}</strong><i style={{ "--fill": `${pair.reachable / Math.max(pair.switchers, 1) * 100}%` } as React.CSSProperties} /></div></section><section className="channel-profile"><div className="section-label"><span>Preferred channel</span><small>Share of qualified switchers</small></div>{channels.map((row) => <AudienceBar key={row.label} label={titleCase(row.label)} value={row.share} count={row.count} />)}<div className="tier-strip"><span>Category intensity</span>{tiers.map((row) => <div key={row.label}><strong>{titleCase(row.label)}</strong><i><b style={{ width: `${row.share * 100}%` }} /></i><em>{pct(row.share)}</em></div>)}</div></section></div></div>}

      {profileTab === "people" && <div className="audience-view people-view"><div className="people-view-head"><div><span className="eyebrow">Recruitment pool</span><h3>People behind the movement</h3><p>{pair.reachable} reachable buyers match the selected behavioral definition.</p></div><label className="search-box"><Search size={14} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search region, occasion, buyer ID" /></label></div><div className="people-table"><div className="table-row table-head"><span>Buyer</span><span>Segment</span><span>Channel</span><span>Selected-window behavior</span><span>Status</span><span /></div>{people.slice(0, 20).map((person, index) => <div className="table-row" key={person.id}><span className="buyer-id"><i className={`avatar a${index % 6}`}>{person.id.slice(-2)}</i><strong>{person.id}</strong></span><span><strong>{person.state} / {titleCase(person.region)}</strong><small>{titleCase(person.tier)} / {titleCase(person.occasion)}</small></span><span>{titleCase(person.channel)}</span><span><strong>{person.destinationPurchases} {toLabel}</strong><small>{person.sourcePurchases} {fromLabel} / {period}w</small></span><span><b className="verified"><ShieldCheck size={12} /> Verified</b>{person.consent && <small>Badge consent</small>}</span><button title={`Open ${person.id}`}><MessageSquareText size={15} /></button></div>)}</div></div>}
    </section>
  </div>;
}

function AudienceBar({ label, sublabel, value, count }: { label: string; sublabel?: string; value: number; count: number }) {
  return <div className="audience-bar"><div><strong>{label}</strong>{sublabel && <small>{sublabel}</small>}</div><span><i style={{ width: `${Math.max(2, value * 100)}%` }} /></span><b>{pct(value)}</b><em>{count}</em></div>;
}

function distributionRows(record: Record<string, number>, total: number) {
  return Object.entries(record).map(([label, count]) => ({ label, count, share: count / Math.max(total, 1) })).sort((a, b) => b.count - a.count);
}

function occasionLabel(value: string) {
  const labels: Record<string, string> = { workout: "Performance-led", daily: "Habit-led", work: "Productivity-led", commute: "Convenience-led", social: "Social-led", gaming: "Long-session energy", afternoon: "Afternoon reset" };
  return labels[value] ?? `${titleCase(value)}-led`;
}

function Study({ pair, period, fromLabel, toLabel, launched, setLaunched }: { pair: PairSummary; period: Period; fromLabel: string; toLabel: string; launched: boolean; setLaunched: (value: boolean) => void }) {
  const [mode, setMode] = useState<"results" | "builder">("results");
  const questions = [
    `Walk me through the moment you chose ${toLabel} instead of ${fromLabel}.`,
    `What first put ${toLabel} into consideration?`,
    "What role did price, promotion, or availability play?",
    "What felt different after trying it?",
    `When would you still choose ${fromLabel}?`,
    "What will determine your next purchase?",
  ];
  if (launched) return <div className="launch-success"><span><Check size={24} /></span><p className="eyebrow">Fielding started</p><h2>The first {Math.min(20, pair.reachable)} verified switchers are being invited.</h2><p>Responses will be joined back to purchase behavior and surfaced in Ask Trends with supporting and contradicting evidence.</p><div><i style={{ width: "14%" }} /></div><small>Invites preparing / 0 of {Math.min(20, pair.reachable)} complete</small><button className="secondary-button" onClick={() => setLaunched(false)}>Back to study</button></div>;
  return <div className="study-view">
    <div className="study-tabs" role="tablist" aria-label="Study view"><button role="tab" aria-selected={mode === "results"} className={mode === "results" ? "active" : ""} onClick={() => setMode("results")}>Example results</button><button role="tab" aria-selected={mode === "builder"} className={mode === "builder" ? "active" : ""} onClick={() => setMode("builder")}>Study design</button></div>
    {mode === "results" ? <ExampleStudy pair={pair} period={period} fromLabel={fromLabel} toLabel={toLabel} onBuild={() => setMode("builder")} /> : <div className="study-grid"><section className="panel study-editor"><div className="panel-head"><div><span className="eyebrow">Discussion guide / {period}-week cohort</span><h2>Why are {fromLabel} buyers choosing {toLabel}?</h2></div><b className="ready"><Check size={12} /> Ready</b></div><div className="objective"><span>Research objective</span><p>Separate the trigger for trial from the reason for repeat, and learn where {fromLabel} still wins.</p></div><div className="questions"><div><span>Adaptive questions</span><small>Follow-up probes are generated from each answer</small></div>{questions.map((question, index) => <label key={question}><b>{String(index + 1).padStart(2, "0")}</b><textarea defaultValue={question} rows={2} /><span><WandSparkles size={13} /></span></label>)}</div></section>
      <aside className="study-sidebar"><section className="panel sample-card"><span className="eyebrow">Sample</span><h3>{Math.min(20, pair.reachable)} of {pair.reachable} reachable</h3><div className="sample-bar"><i style={{ width: `${Math.min(100, 2000 / Math.max(pair.reachable, 1))}%` }} /></div><dl><div><dt>Audience</dt><dd>Verified switchers</dd></div><div><dt>Region quota</dt><dd>6 in top region</dd></div><div><dt>Promo split</dt><dd>Balanced</dd></div><div><dt>Format</dt><dd>8-12 min video</dd></div><div><dt>Expected fielding</dt><dd>1-3 days</dd></div></dl></section><section className="panel launch-card"><div><Beaker size={17} /><span><strong>Synthetic demo</strong><small>No real buyers will be contacted.</small></span></div><button className="primary-button" disabled={!pair.reachable} onClick={() => setLaunched(true)}>Launch study <Send size={14} /></button></section></aside>
    </div>}
  </div>;
}

function ExampleStudy({ pair, period, fromLabel, toLabel, onBuild }: { pair: PairSummary; period: Period; fromLabel: string; toLabel: string; onBuild: () => void }) {
  const sample = Math.min(20, pair.reachable);
  const flavorMentions = Math.round(sample * .7);
  const retainedTrust = Math.round(sample * .55);
  const topRegion = topEntry(pair.regions);
  return <section className="panel example-study">
    <header className="example-study-head"><div><span className="eyebrow">Completed example / synthetic interviews + verified behavior</span><h2>Switching is additive before it becomes exclusive.</h2><p>{toLabel} is winning anticipation and everyday fit. {fromLabel} still owns performance trust, so most buyers describe expanding their repertoire before fully replacing a brand.</p></div><button className="secondary-button" onClick={onBuild}><FlaskConical size={14} /> Open editable guide</button></header>

    <div className="study-result-strip"><div><span>Verified cohort</span><strong>{sample} interviews</strong><small>from {pair.switchers} behavioral switchers</small></div><div><span>Dominant market shift</span><strong>Utility to enjoyable routine</strong><small>{flavorMentions} of {sample} mentioned taste or anticipation</small></div><div><span>Behavioral validation</span><strong>{pct(pair.repeaters / Math.max(pair.switchers, 1))} repeated {toLabel}</strong><small>{pair.repeaters} repeaters in the {period}-week cohort</small></div><div><span>Leading geography</span><strong>{titleCase(topRegion[0])}</strong><small>{topRegion[1]} verified switches</small></div></div>

    <div className="sentiment-section"><div className="sentiment-heading"><span className="eyebrow">Market sentiment shift</span><h3>Energy is becoming an everyday identity product, not only a performance tool.</h3></div><div className="shift-continuum"><div><span>Previous expectation</span><strong>Maximum function</strong><small>Energy, efficacy, gym credibility</small></div><ArrowRight size={18} /><div><span>Emerging expectation</span><strong>Function worth looking forward to</strong><small>Flavor, visual identity, routine fit</small></div></div><ul className="study-findings"><li><b>01</b><span><strong>Zero sugar is now table stakes.</strong> Buyers use flavor and emotional payoff to separate brands after functional requirements are met.</span></li><li><b>02</b><span><strong>The can is a social signal.</strong> Packaging affects trial because buyers expect the product to appear at work, in cars, and in social content.</span></li><li><b>03</b><span><strong>Availability turns novelty into routine.</strong> Convenience distribution matters after a flavor-led first purchase.</span></li></ul></div>

    <div className="brand-sentiment"><div className="brand-sentiment-head"><div><span className="eyebrow">Per-brand sentiment</span><h3>What each brand currently owns</h3></div><span>Share of coded positive mentions</span></div><div className="sentiment-table"><div className="sentiment-row sentiment-table-head"><span>Association</span><span>{fromLabel}</span><span>{toLabel}</span></div><SentimentRow label="Performance trust" source={82} destination={68} /><SentimentRow label="Flavor excitement" source={46} destination={88} /><SentimentRow label="Everyday fit" source={55} destination={84} /><SentimentRow label="Value confidence" source={71} destination={59} /></div><div className="brand-readouts"><div><i style={{ background: COLORS[pair.from] }} /><span><strong>{fromLabel}</strong><small>Trusted for dependable efficacy, but some buyers frame it as intense, functional, or occasion-specific. {retainedTrust} of {sample} still named a situation where it wins.</small></span></div><div><i style={{ background: COLORS[pair.to] }} /><span><strong>{toLabel}</strong><small>Wins on flavor anticipation, design, and daily ritual. Price and novelty remain the clearest threats to durable conversion.</small></span></div></div></div>

    <div className="study-evidence"><blockquote>&ldquo;{fromLabel} is still the one I trust before a hard workout. {toLabel} is the one I actually want in the afternoon.&rdquo;<cite>Verified switcher / Northeast / repeat buyer</cite></blockquote><blockquote>&ldquo;The flavor got me to try it. Seeing it at every convenience store is what made it my regular.&rdquo;<cite>Verified switcher / convenience channel / non-promo trial</cite></blockquote><div className="evidence-note"><ShieldCheck size={16} /><span><strong>Interpretation</strong>Purchase behavior supports early durability, but the interviews explain the mechanism: category expectations are widening from pure efficacy toward enjoyable everyday use.</span></div></div>
  </section>;
}

function SentimentRow({ label, source, destination }: { label: string; source: number; destination: number }) {
  return <div className="sentiment-row"><strong>{label}</strong><span><i><b style={{ width: `${source}%` }} /></i><small>{source}%</small></span><span><i><b style={{ width: `${destination}%` }} /></i><small>{destination}%</small></span></div>;
}

function Agent({ pair, source, destination, fromLabel, toLabel, query, setQuery, answer, isAnalyzing, error, ask }: { pair: PairSummary; source: BrandWindow; destination: BrandWindow; fromLabel: string; toLabel: string; query: string; setQuery: (value: string) => void; answer: AnalysisRun | null; isAnalyzing: boolean; error: string | null; ask: (prompt?: string) => void }) {
  return <div className="agent-layout">
    <section className="agent-main">
      <div className="agent-intro">
        <span><Bot size={21} /></span>
        <div><p className="eyebrow">Audited data science agent</p><h2>From question to defensible analysis.</h2></div>
        <b className="agent-assurance"><ShieldCheck size={13} /> Numeric guard active</b>
      </div>

      {!answer && !isAnalyzing && <>
        <div className="agent-capabilities" aria-label="Analysis workflow"><div><span>01</span><strong>Plan</strong><small>Structure the question</small></div><div><span>02</span><strong>Compute</strong><small>Run approved tools</small></div><div><span>03</span><strong>Verify</strong><small>Check every number</small></div><div><span>04</span><strong>Explain</strong><small>Return an audit trail</small></div></div>
        <div className="suggestion-heading"><span>Try an analysis</span><small>Questions are scoped to the selected brands and window</small></div>
        <div className="suggestion-grid">{SUGGESTIONS.map((suggestion) => <button key={suggestion} onClick={() => ask(suggestion)}><Sparkles size={14} /><span>{suggestion}</span><ArrowRight size={13} /></button>)}</div>
      </>}

      {isAnalyzing && <div className="agent-loading" role="status"><div className="loading-mark"><LoaderCircle size={20} /></div><div><strong>Running the analysis plan</strong><span>{query}</span><ol><li className="done"><Check size={12} /> Validate selected cohort</li><li className="active"><Activity size={12} /> Execute statistical operations</li><li><FileCheck2 size={12} /> Verify narrative against results</li></ol></div></div>}
      {error && !isAnalyzing && <div className="agent-error" role="alert"><CircleHelp size={17} /><div><strong>Analysis did not finish</strong><span>{error}</span></div><button onClick={() => ask(query)}>Run again</button></div>}

      {answer && <article className="analysis-run">
        <header className="run-question"><span>You asked</span><p>{answer.question}</p><div><b>{answer.runId}</b><small>{answer.totalDurationMs.toLocaleString()} ms</small></div></header>
        <section className="run-answer"><div className="answer-label"><Bot size={15} /><span>Evidence-grounded answer</span></div><h2>{answer.answer.title}</h2><p>{answer.answer.summary}</p><div className="finding-list">{answer.answer.findings.map((finding, index) => <div key={`${index}:${finding}`}><Check size={14} /><span>{finding}</span></div>)}</div></section>

        <section className="analysis-plan"><header><div><span className="eyebrow">Executed plan</span><h3>{answer.plan.objective}</h3></div><b>{answer.plan.operations.length} {answer.plan.operations.length === 1 ? "operation" : "operations"}</b></header><p>{answer.plan.rationale}</p><div>{answer.plan.operations.map((operation, index) => <span key={operation.id}><i>{String(index + 1).padStart(2, "0")}</i><strong>{toolLabel(operation.tool)}</strong><small>{operation.purpose}</small><Check size={13} /></span>)}</div></section>

        <section className="results-section"><header><div><span className="eyebrow">Computed evidence</span><h3>Results from the buyer panel</h3></div><span><Database size={13} /> {answer.context.datasetRows.toLocaleString()} rows available</span></header>{answer.results.map((result) => <ResultTable key={result.operationId} result={result} />)}</section>

        <section className="run-caveats"><header><CircleHelp size={15} /><strong>Interpretation limits</strong></header>{answer.answer.caveats.map((caveat, index) => <p key={`${index}:${caveat}`}>{caveat}</p>)}</section>
      </article>}

      <form className="agent-composer" onSubmit={(event) => { event.preventDefault(); ask(); }}><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Ask about ${fromLabel}, ${toLabel}, segments, switching, or market shifts`} /><button type="submit" disabled={!query.trim() || isAnalyzing} aria-label={isAnalyzing ? "Analysis in progress" : "Run analysis"}>{isAnalyzing ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}</button></form>
    </section>

    <aside className="agent-context">
      <span className="eyebrow">Analysis context</span><h3>{fromLabel} vs. {toLabel}</h3>
      <dl><div><dt>Panel</dt><dd>25,000 buyers</dd></div><div><dt>Window</dt><dd>Latest {pair.period} weeks</dd></div><div><dt>Active category buyers</dt><dd>{destination.categoryBuyers.toLocaleString()}</dd></div><div><dt>Source share</dt><dd>{pct(source.observedShare)}</dd></div><div><dt>Destination share</dt><dd>{pct(destination.observedShare)}</dd></div><div><dt>Qualified switches</dt><dd>{pair.switchers}</dd></div></dl>
      {answer ? <div className="audit-trace"><header><span className="eyebrow">Analysis trace</span><b><i /> Complete</b></header>{answer.trace.map((step, index) => <div className="trace-step" key={step.id}><span>{index + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small><em>{step.durationMs} ms{step.rowsScanned ? ` / ${step.rowsScanned.toLocaleString()} rows` : ""}</em></div></div>)}<footer><ShieldCheck size={13} /><span>{answer.planner.mode === "openai" ? `${answer.planner.model} planned and explained; tools supplied all numbers.` : "Local planner active; tools supplied all numbers. Add OPENAI_API_KEY for LLM planning and explanation."}</span></footer></div> : <div className="approved-tools"><span className="eyebrow">Approved operations</span>{["Brand performance", "Switching flow", "Segment rates", "State affinity", "Promotion durability", "Market context", "Trend forecast", "WoE / IV diagnostics"].map((tool) => <div key={tool}><Table2 size={12} /><span>{tool}</span></div>)}</div>}
      <div className="context-rule"><ShieldCheck size={14} /><span>Raw rows stay server-side. Explanations are rejected if they introduce a number absent from the executed results.</span></div>
    </aside>
  </div>;
}

function ResultTable({ result }: { result: AnalysisResult }) {
  return <article className="result-block"><header><div><Table2 size={15} /><span><strong>{result.title}</strong><small>n = {result.sampleSize.toLocaleString()} / {result.rows.length} rows returned</small></span></div><b>{result.durationMs} ms</b></header><div className="result-table-wrap"><table><thead><tr>{result.columns.map((column) => <th key={column}>{columnLabel(column)}</th>)}</tr></thead><tbody>{result.rows.map((row, rowIndex) => <tr key={rowIndex}>{result.columns.map((column) => <td key={column}>{displayValue(row[column])}</td>)}</tr>)}</tbody></table></div><details><summary>Calculation and caveat <ChevronDown size={13} /></summary><div><p><strong>Calculation</strong>{result.calculation}</p><p><strong>Caveat</strong>{result.caveat}</p><p><strong>Execution</strong>{result.rowsScanned.toLocaleString()} dataset rows scanned.</p></div></details></article>;
}

function toolLabel(tool: string) { return columnLabel(tool); }
function columnLabel(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function displayValue(value: ResultValue | undefined) { return value === null || value === undefined ? "-" : typeof value === "number" ? value.toLocaleString() : String(value); }

function pct(value: number) { return `${(value * 100).toFixed(1)}%`; }
function signed(value: number) { return `${value >= 0 ? "+" : ""}${value.toFixed(Number.isInteger(value) ? 0 : 2)}`; }
function signedMaybe(value: number | null) { return value === null ? "not available" : signed(value); }
function titleCase(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function topEntry(record: Record<string, number>): [string, number] { return (Object.entries(record).sort((a, b) => b[1] - a[1])[0] ?? ["not available", 0]) as [string, number]; }
function csvCell(value: string | number) { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
