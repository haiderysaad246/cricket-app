const BATTING_FIELDS = [
  { label: "Runs", render: (b) => b.runs },
  { label: "Matches", render: (b) => b.matches },
  { label: "Ducks", render: (b) => b.ducks },
  { label: "Innings", render: (b) => b.innings },
  { label: "Balls Faced", render: (b) => b.ballsFaced },
  { label: "Average", render: (b) => b.average },
  { label: "Dots", render: (b) => b.dots },
  { label: "Strike Rate", render: (b) => b.strikeRate },
  { label: "4s / 6s", render: (b) => `${b.fours} / ${b.sixes}` },
  { label: "Highest", render: (b) => b.highest },
];

const BOWLING_FIELDS = [
  { label: "Wickets", render: (b) => b.wickets },
  { label: "Maidens", render: (b) => b.maidens || 0 },
  { label: "Dot Ball %", render: (b) => `${b.dotBallPercentage}%` },
  { label: "Innings", render: (b) => b.innings },
  { label: "No Ball Runs", render: (b) => b.noBallRuns },
  { label: "Overs", render: (b) => b.overs },
  { label: "Wide Runs", render: (b) => b.wideRuns },
  { label: "Ball Bowled", render: (b) => b.ballsBowled },
  { label: "Average", render: (b) => b.average },
  { label: "Runs Conceded", render: (b) => b.runsConceded },
  { label: "Economy Rate", render: (b) => b.economyRate },
  { label: "Dots", render: (b) => b.dots },
  { label: "Strike Rate", render: (b) => b.strikeRate },
];

function StatGrid({ title, block, fields }) {
  return (
    <div className="stats-section">
      <h3 className="stats-section-title">{title}</h3>
      <div className="stats-grid">
        {fields.map((f) => (
          <div className="stat-item" key={f.label}>
            <span className="stat-label">{f.label}</span>
            <span className="stat-value">{f.render(block)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StatBlock({ stats }) {
  return (
    <>
      <StatGrid title="Batting Stats" block={stats.batting} fields={BATTING_FIELDS} />
      <StatGrid title="Bowling Stats" block={stats.bowling} fields={BOWLING_FIELDS} />
    </>
  );
}
