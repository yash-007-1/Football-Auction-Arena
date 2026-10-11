import type { TableRow } from '@fa/shared';
import { Crest, Empty, type Game } from '../ui';

export function Move({ n }: { n: number | undefined }) {
  if (!n) return <span className="text-mist-500" aria-label="No change">–</span>;
  return n > 0 ? <span className="text-pitch-300 text-xs" aria-label={`Up ${n}`}>▲{n}</span> : <span className="text-alert-400 text-xs" aria-label={`Down ${-n}`}>▼{-n}</span>;
}

export function LeagueTable({ game, rows, compact = false }: { game: Game; rows?: TableRow[]; compact?: boolean }) {
  const { snap, me, clubOf } = game;
  const table = rows ?? snap.table;
  const n = table.length;
  return (
    <div className="panel overflow-x-auto">
      <table>
        <thead><tr><th className="w-8">#</th><th>Club</th><th className="text-right" title="Played">P</th>{!compact && <><th className="text-right" title="Won">W</th><th className="text-right" title="Drawn">D</th><th className="text-right" title="Lost">L</th><th className="text-right" title="Goals for">GF</th><th className="text-right" title="Goals against">GA</th></>}<th className="text-right" title="Goal difference">GD</th><th className="text-right" title="Points">Pts</th>{!compact && <th>Form</th>}</tr></thead>
        <tbody>
          {table.map((r) => {
            const mine = r.teamId === me.id;
            return (
              <tr key={r.teamId} className={mine ? 'bg-pitch-500/10' : ''}>
                <td className="num text-lg"><span className="inline-flex items-center gap-1">{r.position}</span></td>
                <td><span className="inline-flex items-center gap-2 font-semibold"><Crest club={clubOf(r.teamId)} size={24} /><span className="truncate max-w-[10rem] sm:max-w-none">{r.name}</span>{mine && <span className="chip">You</span>}<Move n={snap.positionChanges[r.teamId]} /></span>
                  <span className="block text-xs muted pl-8">{game.byId.get(r.teamId)?.name}</span></td>
                <td className="num text-right">{r.played}</td>
                {!compact && <><td className="num text-right">{r.won}</td><td className="num text-right">{r.drawn}</td><td className="num text-right">{r.lost}</td><td className="num text-right">{r.goalsFor}</td><td className="num text-right">{r.goalsAgainst}</td></>}
                <td className="num text-right">{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</td>
                <td className={`num text-right text-xl font-bold ${r.position === 1 && r.played > 0 ? 'text-gold-400' : ''}`}>{r.points}</td>
                {!compact && <td><span className="inline-flex gap-1">{r.form.map((f, i) => <span key={i} className={`w-5 h-5 grid place-items-center rounded text-[11px] font-bold ${f === 'W' ? 'bg-pitch-500 text-ink-950' : f === 'D' ? 'bg-mist-500 text-ink-950' : 'bg-alert-500 text-ink-950'}`}>{f}</span>)}</span></td>}
              </tr>
            );
          })}
          {n === 0 && <tr><td colSpan={11}><Empty title="No table yet" /></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function League({ game }: { game: Game }) {
  const { snap } = game;
  const played = snap.fixtures.filter((f) => f.status === 'played').length;
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div><h1 className="h-page">League table</h1><p className="muted mt-1">{played === 0 ? 'No matches played yet.' : `${played} of ${snap.fixtures.length} matches played`}. Ordered by points, goal difference, goals scored, head-to-head, then club name.</p></div>
        {snap.season.status === 'running' && <div className="chip">Matchday {snap.season.currentRound} of {snap.season.totalRounds}</div>}
      </div>
      <LeagueTable game={game} />
      <p className="text-xs text-mist-500">Win 3 points, draw 1, loss 0. Arrows show the change in position since the previous matchday.</p>
    </div>
  );
}
